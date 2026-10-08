import sys
from chrome import *
S = 1024
seed = int(sys.argv[1]) if len(sys.argv) > 1 else 11
bg = liquid_bg((S, S), seed=seed, dim=0.12)
cx, cy = S * 0.5, S * 0.51
rgb, a = star_layer((S, S), cx, cy, S * 0.47, arms=(1.0, 0.68, 0.9, 0.76), p=0.38, tilt=0.10, persp=(0.06, -0.04), rim=1.3)
out = compose(bg, rgb, a, glow_r=12)
out += flare((S, S), cx, cy, 90, 0.45, tilt=-0.10)
save(np.clip(out, 0, 1), f'avatar-{seed}.png')
