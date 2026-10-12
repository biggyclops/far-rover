# Far Rover v0.8 realism mockup: sources

## Ground imagery (real, public domain)
- Product: **NAC_POLE_SOUTH_CM_345_P892S1350**. This is the LROC South Pole Controlled NAC Subsolar Longitude (340-350 deg) Mosaic,
  1 m/px polar stereographic, tile centred at 89.2S 135.0E (lon 90-180E, lat -88.5 to -90). It's built from 422 controlled NAC images
  that all share nearly the same sun azimuth, so the lighting is consistent across the tile.
- Product page: https://wms.lroc.asu.edu/lroc/view_rdr_product/NAC_POLE_SOUTH_CM_345_P892S1350
- Group page: https://wms.lroc.asu.edu/lroc/view_rdr/NAC_POLE_SOUTH_CM_345
- Data actually read: the 8-bit browse pyramid GeoTIFF (256px tiles) by HTTP range reads through GDAL /vsicurl, with no full download:
  https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/BROWSE/NAC_POLE/NAC_POLE_SOUTH_CM_345/NAC_POLE_SOUTH_CM_345_P892S1350.PYR.TIF
  (this redirects to pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/...).
  The full-res IMG is 8.3 GB (45488 x 45488 float32).
- Region: full-res pixels x 15920-21680, y 520-6280 (5760 x 5760 m). It's a cratered plain on the illuminated high ground
  about 10-13 km from the pole, near the Shackleton rim / connecting-ridge area. Saved locally as src_l1.npy.
- Credit: **NASA/GSFC/Arizona State University** (LROC). Citation: Wagner, R. V., Speyerer, E. J., Robinson, M. S., and LROC Team (2015),
  New Mosaicked Data Products from the LROC Team, LPSC 46, abstract #1473.
- The credit line is printed in the lower-left corner of both mockups.

## Processing (scripts in this folder)
- fetch.py: windowed reads from the pyramid. ground.py and makeground.py: rotate the crop 30 deg CCW, so the mosaic's sun
  (sub-solar longitude about 345 deg, i.e. from image-up) comes from the UPPER LEFT, then resample to 1.5 m per output pixel (INTER_AREA).
  Tone: median sunlit regolith goes to about 0.40-0.5, a toe crush makes the shadowed / PSR floors pure black, plus a filmic highlight
  shoulder, a little local contrast and an unsharp mask. No hillshade was synthesised: the long shadows are the real ones from about 1-2 deg sun.
- The full 40x40 map ground plate (2560x2560, world coordinates, 1 output px = 1.5 m, so 3.84 km square) is ground-map-2560-gray.png.
  The mockups crop it at the live camera. About 8.6% of it is black (real shadow, plus a no-data wedge in one corner of the source region).
  In the game plate (`ground-map.png`) those no-data wedges are filled from neighboring sunlit NAC ground (line reflection plus a brightness-matched copy) so the 40×40 map has no empty corner. Real crater floors and PSRs are left black.
- compose.py: the composite. Relit sprites, shadows, contacts, dust apron, haul tracks and frost glint come from relit/ (the second
  worker), drawn at 0.5x. Shadows are composited as one max-alpha layer. The HUD comes from the live page, captured in headless Chrome
  (cdpshot.py) with the canvas hidden: live-opaque*.png and hud-overlay*.png.

## Layout
layout.json: from config.js, game.js bootstrap() and renderer.js, verified against a live 1280x800 screenshot (live-default.png).
