// Listen Together server with rooms.
// Based on FlafyDev/spotify-listen-together-server (MIT). Run with:  node server.js
// One server hosts many rooms. A client that logs in without a room code gets a new room;
// a client that logs in with a code joins that room. Everyone in a room can control playback.
const http = require("http");
const { Server } = require("socket.io");

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  maxDelay: parseInt(process.env.MAX_DELAY, 10) || 5000,
  maxRooms: parseInt(process.env.MAX_ROOMS, 10) || 500,
  maxPerRoom: parseInt(process.env.MAX_PER_ROOM, 10) || 20,
  emptyRoomTtl: 10 * 60 * 1000, // keep an empty room this long so people can reconnect
};

const isListenable = (uri) => uri.startsWith("spotify:track:") || uri.startsWith("spotify:episode:");
const isAd = (uri) => uri.startsWith("spotify:ad:");

const rooms = new Map(); // code -> Room
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, easy to read out loud
function newCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.clients = new Set();
    this.expiry = null;
    this.trackUri = "";
    this.paused = true;
    this.loadingTrack = null;
    this.milliseconds = 0;
    this.locked = false;
    this.lastUpdate = Date.now();
    this.loadAtMilliseconds = 0;
  }

  // ---- membership ----
  join(info) {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    this.clients.add(info);
    this.checkAd();
    if (!this.locked) this.checkDesync();
    this.sendListeners();
  }
  leave(info) {
    this.clients.delete(info);
    this.checkAd();
    this.sendListeners();
    if (this.clients.size === 0) {
      if (this.loadingTrack) clearTimeout(this.loadingTrack);
      this.loadingTrack = null;
      this.trackUri = "";
      this.paused = true;
      this.milliseconds = 0;
      this.expiry = setTimeout(() => rooms.delete(this.code), config.emptyRoomTtl);
    }
  }
  emit(ev, ...args) {
    let maxLatency = 0;
    this.clients.forEach((i) => (maxLatency = Math.max(i.latency, maxLatency)));
    // Clients with lower latency get the event a bit later so everyone acts at the same moment.
    this.clients.forEach((i) => setTimeout(() => i.socket.emit(ev, ...args), maxLatency - i.latency));
  }
  sendListeners() {
    const list = [...this.clients].map((i) => ({ name: i.name, isHost: false, watchingAD: isAd(i.trackUri) }));
    this.clients.forEach((i) => i.socket.emit("listeners", list));
  }

  // ---- playback state ----
  progress() {
    return this.paused ? this.milliseconds : this.milliseconds + (Date.now() - this.lastUpdate);
  }
  updateSong(pause, ms) {
    if (this.loadingTrack === null && isListenable(this.trackUri)) {
      this.paused = pause;
      this.milliseconds = ms;
      this.lastUpdate = Date.now();
      this.emit("updateSong", pause, ms);
      this.loadAtMilliseconds = 0;
    }
  }
  changeSong(uri) {
    if (!isListenable(uri)) return;
    if (this.loadingTrack !== null) clearTimeout(this.loadingTrack);
    this.milliseconds = 0;
    this.trackUri = uri;
    this.emit("changeSong", uri);
    this.loadingTrack = setTimeout(() => this.trackLoaded(), config.maxDelay);
  }
  requestUpdateSong(info, pause, ms) {
    if (this.locked) info?.socket.emit("bottomMessage", "Paused while someone is on an ad.", true);
    else this.updateSong(pause, ms);
  }
  listenerLoadingSong(info, uri) {
    if (uri !== this.trackUri) {
      if (this.locked) info.socket.emit("bottomMessage", "Paused while someone is on an ad.", true);
      else this.changeSong(uri);
    }
  }
  listenerChangedSong(info, uri) {
    if (uri === "") return;
    info.trackUri = uri;
    this.checkAd();
    if (!this.locked) {
      if (this.loadingTrack !== null) this.checkTrackLoaded();
      else this.checkDesync();
    }
  }
  checkTrackLoaded() {
    if ([...this.clients].every((i) => i.trackUri === this.trackUri)) this.trackLoaded();
  }
  checkAd() {
    this.lock([...this.clients].some((i) => isAd(i.trackUri)));
  }
  checkDesync() {
    if (this.loadingTrack === null && [...this.clients].some((i) => i.trackUri !== this.trackUri)) {
      this.loadAtMilliseconds = this.progress();
      this.changeSong(this.trackUri);
    }
  }
  trackLoaded() {
    if (this.loadingTrack) clearTimeout(this.loadingTrack);
    this.loadingTrack = null;
    const ms = this.loadAtMilliseconds;
    this.loadAtMilliseconds = 0;
    setTimeout(() => this.requestUpdateSong(undefined, false, ms), 1000);
  }
  lock(lock) {
    if (this.locked !== lock) {
      this.locked = lock;
      if (!lock) this.changeSong(this.trackUri);
      this.sendListeners();
    }
  }
}

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  let people = 0;
  rooms.forEach((r) => (people += r.clients.size));
  res.end(`Listen Together server is running.\nRooms: ${rooms.size}\nListeners: ${people}\n`);
});
const io = new Server(httpServer, { cors: { origin: "*" }, pingInterval: 1000 });

io.on("connection", (socket) => {
  let lastPing = 0;
  let room = null;
  const info = { socket, latency: 0, name: "Unnamed", trackUri: "" };

  socket.conn.on("packet", (p) => {
    if (p.type === "pong") info.latency = Math.min((Date.now() - lastPing) / 2, config.maxDelay);
  });
  socket.conn.on("packetCreate", (p) => {
    if (p.type === "ping") lastPing = Date.now();
  });

  const refuse = (message) => {
    socket.emit("roomError", message);
    setTimeout(() => socket.disconnect(), 300);
  };

  socket.on("login", (name, _version, roomCode) => {
    if (room) return;
    const code = typeof roomCode === "string" ? roomCode.trim().toUpperCase() : "";
    let target;
    if (code) {
      target = rooms.get(code);
      if (!target) return refuse(`Room "${code.slice(0, 12)}" was not found. Check the code, or create a new room.`);
      if (target.clients.size >= config.maxPerRoom) return refuse("This room is full.");
    } else {
      if (rooms.size >= config.maxRooms) return refuse("The server is full right now. Try again later.");
      target = new Room(newCode());
      rooms.set(target.code, target);
    }
    room = target;
    info.name = String(name || "Unnamed").slice(0, 40);
    socket.emit("room", room.code);
    socket.emit("isHost", true); // everyone in the room can control playback
    room.join(info);
    console.log(`${code ? "join" : "create"} room ${room.code} (${room.clients.size} in room, ${rooms.size} rooms)`);
  });

  socket.on("requestUpdateSong", (pause, ms) => room?.requestUpdateSong(info, !!pause, Math.max(0, Number(ms) || 0)));
  socket.on("loadingSong", (uri) => room?.listenerLoadingSong(info, String(uri || "")));
  socket.on("changedSong", (uri) => room?.listenerChangedSong(info, String(uri || "")));
  socket.on("requestListeners", () => room?.sendListeners());
  socket.on("disconnecting", () => {
    if (room) room.leave(info);
    room = null;
  });
});

httpServer.listen(config.port, () => console.log(`Listen Together server ready on http://localhost:${config.port}`));
