"""Generate Offer Scout PNG icons (180/192/512 + maskable) with Pillow. Run: python3 scripts/make_icons.py"""
from PIL import Image, ImageDraw, ImageFilter
import math, os
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(OUT, exist_ok=True)

def render(size, pad_ratio=0.0):
    S = 1024
    img = Image.new('RGB', (S, S), (11, 15, 20))
    d = ImageDraw.Draw(img)
    # diagonal gradient background
    top, bot = (16, 40, 44), (8, 12, 18)
    for y in range(S):
        t = y / S
        d.line([(0, y), (S, y)], fill=tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3)))
    glow = Image.new('L', (S, S), 0); ImageDraw.Draw(glow).ellipse([180, 120, 900, 840], fill=120)
    glow = glow.filter(ImageFilter.GaussianBlur(140))
    img = Image.composite(Image.new('RGB', (S, S), (34, 227, 161)), img, glow.point(lambda v: v // 3))
    d = ImageDraw.Draw(img)
    sc = 1 - pad_ratio; cx, cy = S / 2, S / 2 + 30 * sc; R = 330 * sc; w = int(78 * sc)
    box = [cx - R, cy - R, cx + R, cy + R]
    d.arc(box, 150, 390, fill=(40, 56, 72), width=w)          # track
    d.arc(box, 150, 330, fill=(34, 227, 161), width=w)        # score (≈75%)
    for a in (150, 330):                                       # round caps
        Rc = R - w / 2; x, y = cx + Rc * math.cos(math.radians(a)), cy + Rc * math.sin(math.radians(a))
        r = w / 2 - 1; d.ellipse([x - r, y - r, x + r, y + r], fill=(34, 227, 161))
    # needle
    ang = math.radians(300); L = R * 0.78
    d.line([(cx, cy), (cx + L * math.cos(ang), cy + L * math.sin(ang))], fill=(238, 243, 248), width=int(44 * sc))
    hr = 62 * sc; d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=(238, 243, 248))
    # dollar coin
    cr = 120 * sc; ccx, ccy = cx, cy + R * 0.62
    d.ellipse([ccx - cr, ccy - cr, ccx + cr, ccy + cr], fill=(34, 227, 161))
    t = 22 * sc; h = cr * 0.62
    d.arc([ccx - h * 0.62, ccy - h, ccx + h * 0.62, ccy], 90, 360, fill=(4, 34, 26), width=int(t))
    d.arc([ccx - h * 0.62, ccy, ccx + h * 0.62, ccy + h], 270, 540, fill=(4, 34, 26), width=int(t))
    d.line([(ccx, ccy - h - 22 * sc), (ccx, ccy + h + 22 * sc)], fill=(4, 34, 26), width=int(t * 0.8))
    return img.resize((size, size), Image.LANCZOS)

render(180).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
render(192).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
render(512).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
render(512, pad_ratio=0.2).save(os.path.join(OUT, 'maskable-512.png'), optimize=True)
print('icons written to', os.path.abspath(OUT))
