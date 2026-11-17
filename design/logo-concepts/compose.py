"""Compose generated Javis concept images into numbered comparison sheets."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
CONCEPTS = json.loads((ROOT / 'concepts.json').read_text())
CN_FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
EN_FONT = '/System/Library/Fonts/Avenir Next.ttc'
DARK = '#152035'
GRAY = '#687285'

def font(size, chinese=False):
    return ImageFont.truetype(CN_FONT if chinese else EN_FONT, size)

def centered(draw, box, text, face, fill):
    left, top, right, bottom = box
    bounds = draw.textbbox((0, 0), text, font=face)
    x = left + ((right-left)-(bounds[2]-bounds[0])) / 2 - bounds[0]
    y = top + ((bottom-top)-(bounds[3]-bounds[1])) / 2 - bounds[1]
    draw.text((x, y), text, font=face, fill=fill)

images = []
for concept in CONCEPTS:
    path = ROOT / concept['file']
    with Image.open(path) as img:
        img.load()
        if img.size != (1024, 1024):
            raise ValueError(f'{path.name}: unexpected size {img.size}')
        images.append(img.convert('RGB'))

board = Image.new('RGB', (2000, 1040), '#FFFFFF')
draw = ImageDraw.Draw(board)
draw.text((44, 28), 'JAVIS', font=font(54), fill=DARK)
draw.text((250, 52), 'LOGO CONCEPTS / 01—10', font=font(25), fill=GRAY)
draw.text((46, 100), '独立桌面 CUA · 观察、执行、验证 · 十个不同的图标方向', font=font(24, True), fill=GRAY)
for index, (concept, img) in enumerate(zip(CONCEPTS, images)):
    col, row = index % 5, index // 5
    x, y = 44 + col * 388, 152 + row * 420
    draw.rounded_rectangle((x, y, x+360, y+392), radius=18, fill='#F5F6F8', outline='#E6E9EE', width=1)
    draw.rounded_rectangle((x+18, y+18, x+63, y+57), radius=10, fill=DARK)
    centered(draw, (x+18, y+18, x+63, y+57), concept['number'], font(25), 'white')
    draw.text((x+76, y+21), concept['name'], font=font(26, True), fill=DARK)
    board.paste(img.resize((266, 266), Image.Resampling.LANCZOS), (x+47, y+74))
    draw.text((x+20, y+355), '32 px', font=font(17), fill=GRAY)
    board.paste(img.resize((32, 32), Image.Resampling.LANCZOS), (x+85, y+346))
    draw.rounded_rectangle((x+135, y+344, x+178, y+381), radius=7, fill=DARK)
    board.paste(img.resize((32, 32), Image.Resampling.LANCZOS), (x+141, y+347))
    draw.text((x+213, y+355), '16 px', font=font(17), fill=GRAY)
    board.paste(img.resize((16, 16), Image.Resampling.LANCZOS), (x+276, y+354))
draw.text((46, 995), '编号对应独立 1024 × 1024 PNG 原稿。选中后继续精修轮廓、配色与系统图标。', font=font(22, True), fill=GRAY)
board.save(ROOT / 'overview.png', optimize=True)

sheet = Image.new('RGB', (1200, 1690), '#FFFFFF')
draw = ImageDraw.Draw(sheet)
draw.text((36, 24), 'JAVIS / SMALL-SIZE CHECK', font=font(34), fill=DARK)
draw.text((36, 79), '同一张原稿缩小到 128 / 64 / 32 / 16 像素', font=font(24, True), fill=GRAY)
for x, name in [(310, '128 px'), (570, '64 px'), (795, '32 px'), (990, '16 px')]:
    draw.text((x, 132), name, font=font(22), fill=GRAY)
for index, (concept, img) in enumerate(zip(CONCEPTS, images)):
    y = 188 + index * 145
    draw.line((30, y-8, 1170, y-8), fill='#E6E9EE')
    draw.text((36, y+42), concept['number'], font=font(27), fill=DARK)
    draw.text((88, y+44), concept['name'], font=font(24, True), fill=DARK)
    for x, size in [(310, 128), (570, 64), (795, 32), (990, 16)]:
        sheet.paste(img.resize((size, size), Image.Resampling.LANCZOS), (x, y+(128-size)//2))
sheet.save(ROOT / 'small-sizes.png', optimize=True)
print(ROOT / 'overview.png')
print(ROOT / 'small-sizes.png')
