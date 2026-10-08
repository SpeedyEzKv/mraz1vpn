"""Хромированная стеклянная звезда и фон «жидкий металл» — рендер на numpy.

Звезда: поле высот с четырьмя лучами → нормали → отражение синтетического студийного окружения.
Фон: доменно-искажённый шум → те же нормали → тёмное отражение (серебряные разводы на чёрном).
"""
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter

rng = np.random.default_rng(7)


def norm(v):
    return v / np.linalg.norm(v)


# ---------- окружение: тёмная студия с софтбоксами и холодным отливом ----------
LOBES = [
    # направление, острота, яркость, цвет
    (norm(np.array([-0.55, 0.65, 0.55])), 18.0, 2.6, (1.00, 1.00, 1.00)),
    (norm(np.array([0.70, 0.35, 0.60])), 30.0, 1.6, (0.80, 0.88, 1.00)),
    (norm(np.array([0.10, -0.80, 0.55])), 14.0, 0.9, (0.55, 0.65, 0.95)),
    (norm(np.array([-0.75, -0.30, 0.55])), 40.0, 1.3, (0.95, 0.97, 1.00)),
    (norm(np.array([0.0, 0.0, 1.0])), 6.0, 0.35, (0.70, 0.78, 1.00)),
]


def env(rx, ry, rz, dim=1.0):
    """Сфера окружения: тёмная, с софтбоксами на ~60° от взгляда и светлым кольцом у горизонта."""
    th = np.arccos(np.clip(rz, -1, 1))
    ph = np.arctan2(ry, rx)
    out = np.zeros(rx.shape + (3,)) + np.array([0.010, 0.012, 0.020])

    def lobe(theta0, phi0, sth, sph, amp, col):
        dph = np.angle(np.exp(1j * (ph - phi0)))
        w = amp * np.exp(-((th - theta0) / sth) ** 2 - (dph / sph) ** 2)
        return w[..., None] * np.array(col)

    d = np.deg2rad
    out += lobe(1.05, d(135), 0.30, 0.55, 3.0, (1.0, 1.0, 1.0))
    out += lobe(1.00, d(40), 0.25, 0.35, 1.8, (0.92, 0.95, 1.0))
    out += lobe(1.10, d(-50), 0.35, 0.30, 1.2, (0.55, 0.68, 1.0))
    out += lobe(0.95, d(-140), 0.22, 0.45, 2.0, (1.0, 1.0, 1.0))
    out += lobe(0.55, d(90), 0.20, 0.9, 0.6, (0.8, 0.85, 1.0))
    # кольцо у горизонта: края светятся
    ring = np.exp(-((th - 1.42) / 0.16) ** 2) * 1.8
    out += ring[..., None] * np.array([0.85, 0.9, 1.0])
    # хромовые прожилки: тонкие тёмные/светлые полосы по азимуту
    streak = 0.75 + 0.25 * np.cos(ph * 7 + th * 9)
    out *= streak[..., None]
    return out * dim


def shade(h, k, dim=1.0, smax=None, tilt_extra=None):
    gy, gx = np.gradient(h)
    gx, gy = -gx * k, gy * k  # ny вверх: строки растут вниз
    if smax is not None:
        # уклон ограничен: грани держат наклон, гребни и края дают резкие переходы
        mag = np.sqrt(gx ** 2 + gy ** 2) + 1e-9
        sl = np.tanh(mag) * smax
        if tilt_extra is not None:
            sl = sl + tilt_extra
        gx, gy = gx / mag * sl, gy / mag * sl
    nx, ny, nz = gx, gy, np.ones_like(h)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    nx, ny, nz = nx / ln, ny / ln, nz / ln
    rx, ry, rz = 2 * nz * nx, 2 * nz * ny, 2 * nz * nz - 1
    col = env(rx, ry, rz, dim)
    fres = (1 - nz) ** 3
    col += fres[..., None] * np.array([0.6, 0.7, 1.0]) * 0.4
    return col


# ---------- звезда ----------
def star_layer(size, cx, cy, scale, arms=(1.0, 0.62, 0.82, 0.7), p=0.40, tilt=0.0, persp=(0.0, 0.0), ss=2,
               smax=0.5, edge=1.5, wav=0.04, rim=0.9, core=2.5):
    """arms: длины лучей (вверх, вправо, вниз, влево) в долях scale. Возвращает RGB и альфу."""
    W, H = size
    ys, xs = np.mgrid[0:H * ss, 0:W * ss].astype(np.float64)
    x = (xs / ss - cx) / scale
    y = (cy - ys / ss) / scale
    w = 1 + persp[0] * x + persp[1] * y
    x, y = x / w, y / w
    c, s = np.cos(tilt), np.sin(tilt)
    x, y = c * x + s * y, -s * x + c * y
    ax = np.where(x >= 0, arms[1], arms[3])
    ay = np.where(y >= 0, arms[0], arms[2])
    f = (np.abs(x) / ax) ** p + (np.abs(y) / ay) ** p
    t = np.clip(1 - f, 0, 1)
    h = t ** 0.55
    h = h + wav * (np.sin(9 * x + 4 * y) + 0.7 * np.sin(-7 * y + 11 * x) + 0.5 * np.sin(23 * x - 17 * y)) * t
    h = gaussian_filter(h, 1.1 * ss)
    col = shade(h, 400.0, smax=smax, tilt_extra=edge * np.exp(-t / 0.05))
    # тонкий светящийся край
    col += (np.exp(-t / 0.012) * (f < 1) * rim)[..., None] * np.array([0.8, 0.88, 1.0])
    # центр — яркий блик
    col += (np.exp(-(x ** 2 + y ** 2) / 0.0007) * core)[..., None]
    col = np.stack([gaussian_filter(col[..., i], 0.7 * ss) for i in range(3)], -1)
    alpha = gaussian_filter((f < 1).astype(np.float64), 0.6 * ss)
    rgb = Image.fromarray(np.uint8(np.clip(tonemap(col), 0, 1) * 255)).resize((W, H), Image.LANCZOS)
    al = Image.fromarray(np.uint8(np.clip(alpha, 0, 1) * 255)).resize((W, H), Image.LANCZOS)
    return np.asarray(rgb) / 255.0, np.asarray(al) / 255.0


def tonemap(c):
    return 1 - np.exp(-c * 1.15)


# ---------- фон: жидкий металл ----------
def liquid_bg(size, seed=3, dim=0.22, scale=1.0):
    W, H = size
    r = np.random.default_rng(seed)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    x, y = xs / max(W, H) * scale, ys / max(W, H) * scale
    def field(x, y, n, fmin, fmax, s):
        out = np.zeros_like(x)
        for _ in range(n):
            a = r.uniform(0, np.pi)
            fr = r.uniform(fmin, fmax)
            ph = r.uniform(0, 2 * np.pi)
            out += np.sin(fr * (np.cos(a) * x + np.sin(a) * y) + ph) / n
        return out * s
    wx = field(x, y, 6, 2, 6, 1.2)
    wy = field(x, y, 6, 2, 6, 1.2)
    h = field(x + wx, y + wy, 5, 3, 9, 1.0)
    h = np.sin(h * 6.0)  # тонкие изгибающиеся ленты
    h = gaussian_filter(h, 2.0)
    col = shade(h * 40, 1.0, dim=dim)
    # виньетка
    cxn, cyn = (xs / W - 0.5), (ys / H - 0.5)
    vig = np.clip(1 - (cxn ** 2 + cyn ** 2) * 2.2, 0, 1) ** 1.3
    col *= vig[..., None]
    return np.clip(tonemap(col), 0, 1)


def glow(alpha, radius, color, strength):
    g = gaussian_filter(alpha, radius)
    return g[..., None] * np.array(color) * strength


def bloom(rgb, thr=0.75, radius=12, strength=0.9):
    b = np.clip(rgb - thr, 0, 1)
    b = np.stack([gaussian_filter(b[..., i], radius) for i in range(3)], -1)
    return b * strength


def flare(size, cx, cy, length, strength=1.0, tilt=0.0):
    """Тонкие лучи-блики из центра (горизонталь и вертикаль) — «искра»."""
    W, H = size
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    x, y = xs - cx, ys - cy
    c, s = np.cos(tilt), np.sin(tilt)
    x, y = c * x + s * y, -s * x + c * y
    th = 1.2
    out = np.exp(-(y / th) ** 2) * np.exp(-np.abs(x) / length) + np.exp(-(x / th) ** 2) * np.exp(-np.abs(y) / (length * 1.3))
    out += np.exp(-(x ** 2 + y ** 2) / (length * 0.08) ** 2) * 0.8
    return out[..., None] * np.array([0.9, 0.95, 1.0]) * strength


def compose(bg, star_rgb, star_a, glow_r=18):
    out = bg * (1 - star_a[..., None]) + star_rgb * star_a[..., None]
    halo = (1 - star_a)[..., None]  # свечение только вокруг, не поверх хрома
    out += glow(star_a, glow_r * 0.5, (0.85, 0.9, 1.0), 0.55) * halo
    out += glow(star_a, glow_r, (0.75, 0.82, 1.0), 0.3) * halo
    out += glow(star_a, glow_r * 5, (0.30, 0.40, 0.85), 0.22)
    out += bloom(star_rgb * star_a[..., None], 0.9, glow_r * 0.7, 0.45)
    return np.clip(out, 0, 1)


def save(arr, path, quality=None):
    im = Image.fromarray(np.uint8(np.clip(arr, 0, 1) * 255))
    if quality:
        im.save(path, quality=quality)
    else:
        im.save(path)
    return im
