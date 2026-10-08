from chrome import *
import numpy as np

def rgba_from_black(arr):
    """Картинка на чёрном → RGBA для наложения на тёмный фон (альфа = яркость)."""
    a = np.clip(arr.max(-1), 0, 1)
    rgb = np.where(a[..., None] > 1e-4, arr / np.maximum(a[..., None], 1e-4), 0)
    return Image.fromarray(np.uint8(np.dstack([np.clip(rgb, 0, 1), a]) * 255), 'RGBA')

# Баннер: фон + звезда справа
W, H = 1280, 720
bg = liquid_bg((W, H), seed=11, dim=0.13)
cx, cy = 930, 365
rgb, a = star_layer((W, H), cx, cy, 330, arms=(1.0, 0.72, 0.95, 0.8), p=0.38, tilt=0.14, persp=(0.07, -0.03), rim=1.3)
out = compose(bg, rgb, a, glow_r=12) + flare((W, H), cx, cy, 70, 0.4, tilt=-0.14)
save(np.clip(out, 0, 1), 'banner-bg.png')

# Звезда для кабинета на прозрачном фоне (с ореолом)
S = 640
zero = np.zeros((S, S, 3))
rgb, a = star_layer((S, S), S / 2, S / 2, S * 0.44, arms=(1.0, 0.72, 0.95, 0.8), p=0.38, tilt=0.12, persp=(0.06, -0.03), rim=1.3)
out = compose(zero, rgb, a, glow_r=9) + flare((S, S), S / 2, S / 2, 50, 0.35, tilt=-0.12)
rgba_from_black(np.clip(out, 0, 1)).save('star-hero.png')

# Знак для шапки: прямая звезда, без перспективы, крупнее в кадре
S = 256
zero = np.zeros((S, S, 3))
rgb, a = star_layer((S, S), S / 2, S / 2, S * 0.48, arms=(1.0, 0.8, 1.0, 0.8), p=0.40, smax=0.5, rim=1.2, core=1.8, ss=3)
out = compose(zero, rgb, a, glow_r=3)
rgba_from_black(np.clip(out, 0, 1)).save('star-logo.png')

# Фон «жидкий металл» для кабинета: очень тёмный
bgw = liquid_bg((900, 1600), seed=5, dim=0.10)
save(bgw, 'liquid.jpg', quality=80)
