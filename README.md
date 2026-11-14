# Listen Together (rooms)

Listen to the same song at the same moment with friends on Spotify desktop. No Premium needed.

This is a [Spicetify](https://spicetify.app/) extension plus a small server. It is a fork of
[FlafyDev/spotify-listen-together](https://github.com/FlafyDev/spotify-listen-together), fixed for
current Spotify versions and changed to use rooms: one public server, and each group gets its own
room code.

## Use it

1. Install [Spicetify](https://spicetify.app/).
2. Put `listenTogether.js` in the Spicetify `Extensions` folder (`%appdata%\spicetify\Extensions` on Windows), then run:

   ```
   spicetify config extensions listenTogether.js
   spicetify apply
   ```

3. In Spotify, press the **Listen Together** button in the top bar.
   - **Create a room** gives you a 6-character code. Send it to your friends.
   - **Join a room** and type the code a friend sent you.

Everyone in a room can play, pause, seek and change the song, and it happens for everyone.

## Run your own server

```
npm install
npm start
```

The server listens on `PORT` (default 3000). Any Node host with WebSocket support works.
Spotify only connects to `https` addresses (or `localhost`), so put it behind HTTPS.

To point the extension at your server, open **Listen Together > Server settings** in Spotify, or
change `DEFAULT_SERVER` in `listenTogether.js`.

## Notes

- Works on the Spotify desktop app only (Spicetify does not run on phones or the web player).
- A big Spotify update can break Spicetify extensions, including this one.
- If someone in the room gets an ad, playback waits for them.

## Credits

Created by [FlafyDev](https://github.com/FlafyDev) (original extension and server, MIT license).
Rooms version developed by ARO ([kakaa511](https://github.com/kakaa511)).
