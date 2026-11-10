# Draws one hook line on a reel in one of 4 looks (PNG overlay, so ffmpeg needs no drawtext).
# usage: python3 render.py in.mp4 out.mp4 "<hook text>" <style 1-4>
import sys, subprocess, json, textwrap, os
from PIL import Image, ImageDraw, ImageFont
src, out, text, style = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
p = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', src]))['streams'][0]
W, H = p['width'], p['height']
FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf']
fp = next(f for f in FONTS if os.path.exists(f))
size = int(H * (0.040 if style != 4 else 0.036)); font = ImageFont.truetype(fp, size)
lines = textwrap.wrap(text, 24)[:2]
img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
lh = int(size * 1.25); boxw = max(d.textlength(l, font=font) for l in lines); th = lh * len(lines)
y0 = {1: 0.13, 2: 0.13, 3: 0.56, 4: 0.72}[style] * H
pad = int(size * 0.55)
if style in (1, 2):
    fill_box = (255, 255, 255, 240) if style == 1 else (0, 0, 0, 215)
    d.rounded_rectangle([(W - boxw) / 2 - pad, y0 - pad * 0.7, (W + boxw) / 2 + pad, y0 + th + pad * 0.5], radius=int(size * 0.45), fill=fill_box)
for i, l in enumerate(lines):
    x = (W - d.textlength(l, font=font)) / 2; y = y0 + i * lh
    if style == 1: d.text((x, y), l, font=font, fill=(0, 0, 0, 255))
    elif style == 2: d.text((x, y), l, font=font, fill=(255, 255, 255, 255))
    elif style == 3: d.text((x, y), l, font=font, fill=(255, 255, 255, 255), stroke_width=max(3, size // 9), stroke_fill=(0, 0, 0, 255))
    else: d.text((x, y), l, font=font, fill=(255, 221, 0, 255), stroke_width=max(3, size // 10), stroke_fill=(0, 0, 0, 255))
png = out + '.png'; img.save(png)
subprocess.check_call(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', src, '-i', png, '-filter_complex', '[0:v][1:v]overlay=0:0,format=yuv420p[v]', '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', '-movflags', '+faststart', out])
os.remove(png)
