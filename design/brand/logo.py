from chrome import *
import numpy as np
def rgba_from_black(arr):
    a = np.clip(arr.max(-1), 0, 1)
    rgb = np.where(a[..., None] > 1e-4, arr / np.maximum(a[..., None], 1e-4), 0)
    return Image.fromarray(np.uint8(np.dstack([np.clip(rgb, 0, 1), a]) * 255), 'RGBA')
S = 256
zero = np.zeros((S, S, 3))
rgb, a = star_layer((S, S), S / 2, S / 2, S * 0.49, arms=(1.0, 0.86, 1.0, 0.86), p=0.56, smax=0.5, rim=1.0, core=1.5, ss=3, wav=0.02)
out = compose(zero, rgb, a, glow_r=3)
rgba_from_black(np.clip(out, 0, 1)).save('star-logo.png')
im = Image.new('RGB', (S, S), (12, 14, 18)); lg = Image.open('star-logo.png'); im.paste(lg, (0, 0), lg); im.resize((64, 64), Image.LANCZOS).resize((256, 256), Image.NEAREST).save('logo-check.png')
