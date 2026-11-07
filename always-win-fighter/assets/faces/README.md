# Drop-in default faces (optional)

To replace the cartoon faces for everyone who plays your copy of the game:

1. Put two square-ish images in this folder, for example `hero.png` and `challenger.png`.
2. Edit `faces.js` in this folder and point to them:

   ```js
   window.AWF_FACES = { hero: 'assets/faces/hero.png', challenger: 'assets/faces/challenger.png' };
   ```

Any size works; the image is cover-fitted and clipped to a circle, so a face that
fills most of the picture looks best. Faces a player uploads in the
"Customize Fighters" screen take priority over these files.
