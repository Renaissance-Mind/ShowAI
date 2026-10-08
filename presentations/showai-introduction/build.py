#!/usr/bin/env python3
"""Build ShowAI's five-slide introduction with editable DrawAI PPT objects."""

from __future__ import annotations

import argparse
from collections import Counter
import json
import math
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent
DEFAULT_SKILL = Path.home() / ".codex/plugins/cache/drawai-local/drawai/2.0.4/skills/drawai-ppt"
BUNDLED_SKILL = ROOT / "toolkit/drawai-ppt"
SKILL = Path(os.environ.get("SKILL_DIR", str(BUNDLED_SKILL if BUNDLED_SKILL.is_dir() else DEFAULT_SKILL)))
sys.path.insert(0, str(SKILL / "scripts"))
from pptx_skill import Document, export_pptx, export_svg, render_pptx, validate_pptx_package

W, H = 960, 540
GREEN, INK, PAPER = "#254F3E", "#24332B", "#F5F3ED"
SAGE, ORANGE, WHITE = "#DCE6D9", "#D79458", "#FFFFFF"
MUTED, BORDER, DARK_LINE = "#67766B", "#D7DCD2", "#668775"
CN, EN = "Microsoft YaHei", "Arial"


BRAND_ASSETS = ROOT.parents[1] / "src/desktop/assets"
if not (BRAND_ASSETS / "icon-design.json").is_file():
    BRAND_ASSETS = ROOT / "assets"
BRAND = json.loads((BRAND_ASSETS / "icon-design.json").read_text())
BRAND_MASK = json.loads((BRAND_ASSETS / "apple-icon-mask.json").read_text())


class Slide:
    def __init__(self, number: int, title: str, dark: bool = False, notes: str = ""):
        self.number, self.dark, self.objects = number, dark, []
        self.notes = notes
        self.label = title
        self.color = WHITE if dark else INK
        self.muted = "#C0D0C3" if dark else MUTED
        self.background = GREEN if dark else PAPER

    def add(self, kind: str, name: str, x: float, y: float, w: float, h: float, **props):
        self.objects.append({"id": f"s{self.number}-{name}-{len(self.objects):03d}", "kind": kind,
                             "properties": {"object.frame": {"left": x, "top": y, "width": w, "height": h}, **props}})

    def text(self, value: str, x: float, y: float, w: float, h: float,
             size: float = 16, color: str | None = None, bold: bool = False,
             align: str = "l", latin: str = EN):
        self.add("text_box", "text", x, y, w, h, **{
            "text.run.font.latin": latin, "text.run.font.east_asian": CN,
            "text.run.font.size": size, "text.run.font.bold": bold,
            "text.run.fill": {"kind": "solid", "color": color or self.color},
            "text.run.language": "zh-CN", "text.body.wrap": "none",
            "text.body.vertical_anchor": "t", "text.body.autofit": {"mode": "none"},
            "text.body.insets": {"left": 0, "top": 0, "right": 0, "bottom": 0},
            "text.body.paragraphs": [{"properties": {
                "text.paragraph.alignment": align,
                "text.paragraph.space_after": {"mode": "points", "value": 0},
                "text.paragraph.line_spacing": {"mode": "ratio", "value": 1.16}},
                "content": [{"kind": "run", "text": value}]}]})

    def rect(self, x, y, w, h, fill=None, stroke=None, width=1, rounded=False):
        props = {"shape.geometry.preset": "roundRect" if rounded else "rect",
                 "paint.kind": "solid" if fill else "none",
                 "stroke.width": width, "stroke.paint": stroke or {"kind": "none"}}
        if fill:
            props["paint.solid.color"] = fill
        if rounded:
            props["shape.geometry.adjustments"] = [{"name": "adj", "formula": "val 5000"}]
        self.add("shape", "panel", x, y, w, h, **props)

    def circle(self, x, y, diameter, fill=None, stroke=None, width=1):
        props = {"shape.geometry.preset": "ellipse", "paint.kind": "solid" if fill else "none",
                 "stroke.width": width, "stroke.paint": stroke or {"kind": "none"}}
        if fill:
            props["paint.solid.color"] = fill
        self.add("shape", "circle", x, y, diameter, diameter, **props)

    def path(self, points, color=None, width=1.4, closed=False, fill=None):
        x, y = min(p[0] for p in points), min(p[1] for p in points)
        w = max(max(p[0] for p in points) - x, 0.1)
        h = max(max(p[1] for p in points) - y, 0.1)
        commands = [{"op": "moveTo" if i == 0 else "lineTo",
                     "x": round((px-x)/w*100000), "y": round((py-y)/h*100000)}
                    for i, (px, py) in enumerate(points)]
        if closed:
            commands.append({"op": "close"})
        props = {"shape.geometry.paths": [{"w": 100000, "h": 100000,
                                          "fill": "norm" if fill else "none", "commands": commands}],
                 "paint.kind": "solid" if fill else "none",
                 "stroke.paint": color or self.color, "stroke.width": width,
                 "stroke.cap": "rnd", "stroke.join": "round"}
        if fill:
            props["paint.solid.color"] = fill
        self.add("shape", "path", x, y, w, h, **props)

    def line(self, x1, y1, x2, y2, color=None, width=1.2):
        self.path([(x1, y1), (x2, y2)], color, width)

    def arrow(self, x1, y1, x2, y2, color=None, width=1.3, head=5):
        self.line(x1, y1, x2, y2, color, width)
        angle = math.atan2(y2-y1, x2-x1)
        self.path([(x2-head*math.cos(angle-0.6), y2-head*math.sin(angle-0.6)), (x2,y2),
                   (x2-head*math.cos(angle+0.6), y2-head*math.sin(angle+0.6))], color, width)

    def brand(self, x, y, size=20):
        scale = size / BRAND["canvasSize"]
        palette = BRAND["appearances"]["light" if self.dark else "dark"]
        outline = [(x+(2+px*508/512)*scale, y+(2+py*508/512)*scale) for px,py in BRAND_MASK["points"]]
        first = len(self.objects)
        self.path(outline, palette["background"], 0, closed=True, fill=palette["background"])
        cx=(BRAND["canvasSize"]-BRAND["cardWidth"])/2
        cy=(BRAND["canvasSize"]-BRAND["cardHeight"])/2
        positions=[(cx+BRAND["offsetX"],cy-BRAND["offsetY"]),(cx,cy),(cx-BRAND["offsetX"],cy+BRAND["offsetY"])]
        adjustment=round(BRAND["cornerRadius"]/min(BRAND["cardWidth"],BRAND["cardHeight"])*100000)
        for index,(left,top) in enumerate(positions):
            if index:
                self.rect(x+left*scale,y+top*scale,BRAND["cardWidth"]*scale,BRAND["cardHeight"]*scale,
                          stroke=palette["background"],width=BRAND["gap"]*2*scale,rounded=True)
                self.objects[-1]["properties"]["shape.geometry.adjustments"]=[{"name":"adj","formula":f"val {adjustment}"}]
            self.rect(x+left*scale,y+top*scale,BRAND["cardWidth"]*scale,BRAND["cardHeight"]*scale,
                      fill=BRAND["blue"] if index==1 else palette["foreground"],rounded=True)
            self.objects[-1]["properties"]["shape.geometry.adjustments"]=[{"name":"adj","formula":f"val {adjustment}"}]
        self.path(outline, palette["border"], 3*scale, closed=True)
        for index,obj in enumerate(self.objects[first:]):
            obj["id"]=f"s{self.number}-showai-brand-{index}"

    def chrome(self, label, headline=None, sub=None):
        self.text(f"{self.number:02d} / {label}", 44, 24, 450, 20, 11, self.muted)
        self.brand(837, 24, 20)
        self.text("ShowAI", 862, 22, 60, 24, 13, bold=True)
        self.line(44, 61, 77, 61, ORANGE, 3)
        if headline:
            self.text(headline, 44, 78, 880, 58, 32, bold=True)
        if sub:
            self.text(sub, 44, 139, 880, 28, 14, self.muted)
        self.line(44, 499, 916, 499, DARK_LINE if self.dark else BORDER, 0.7)
        self.text("SHOWAI  ·  PROJECT INTRODUCTION", 44, 509, 480, 16, 9, self.muted)
        self.text(f"{self.number:02d}", 877, 506, 39, 21, 11, self.muted, align="r")

    def icon(self, kind, x, y, size=26, color=None):
        c, s = color or self.color, size / 26
        def line(a,b,d,e): self.line(x+a*s,y+b*s,x+d*s,y+e*s,c,1.6)
        def path(pts,closed=False): self.path([(x+a*s,y+b*s) for a,b in pts],c,1.6,closed)
        def rect(a,b,w,h): self.rect(x+a*s,y+b*s,w*s,h*s,stroke=c,width=1.6,rounded=True)
        if kind == "chart":
            line(2,25,2,3)
            for a,b in ((8,13),(15,7),(22,2)): line(a,25,a,b)
        elif kind == "table":
            rect(1,2,24,22)
            for a in (9,17): line(a,2,a,24)
            for b in (9,16): line(1,b,25,b)
        elif kind == "slider":
            for b,a in ((5,17),(13,7),(21,18)):
                line(1,b,a-3,b); line(a+3,b,25,b)
                self.circle(x+(a-3)*s,y+(b-3)*s,6*s,fill=self.background,stroke=c,width=1.5)
        elif kind == "image":
            rect(1,2,24,22)
            path([(4,20),(10,12),(15,18),(19,11),(24,20)])
            self.circle(x+5*s,y+6*s,3*s,fill=c)
        elif kind == "bookmark":
            path([(5,2),(21,2),(21,25),(13,19),(5,25)],True)
        elif kind == "component":
            for a,b in ((2,2),(16,2),(2,16),(16,16)): rect(a,b,9,9)
        elif kind == "file":
            path([(5,1),(16,1),(23,8),(23,25),(5,25)],True)
            path([(16,1),(16,8),(23,8)])
            for b in (13,17,21): line(9,b,19,b)
        elif kind == "person":
            self.circle(x+8*s,y+1*s,10*s,stroke=c,width=1.6)
            path([(2,25),(2,20),(6,15),(20,15),(24,20),(24,25)])
        elif kind == "agent":
            rect(2,7,22,18); line(13,2,13,7)
            self.circle(x+11*s,y,4*s,fill=c)
            for a in (8,18): self.circle(x+(a-1.5)*s,y+12*s,3*s,fill=c)
            line(8,20,18,20)
        elif kind == "layers":
            path([(13,2),(25,8),(13,14),(1,8)],True)
            path([(1,13),(13,19),(25,13)])
            path([(1,18),(13,24),(25,18)])
        elif kind == "share":
            for a,b in ((2,10),(19,1),(19,19)): self.circle(x+a*s,y+b*s,6*s,stroke=c,width=1.5)
            line(8,12,19,6); line(8,15,19,22)
        elif kind in ("html", "site", "inline"):
            if kind == "site":
                rect(5,0,20,18); rect(2,3,20,18)
            rect(0,6,22,19); line(0,11,22,11)
            for a in (3,6,9): self.circle(x+(a-.7)*s,y+8*s,1.4*s,fill=c)
            if kind == "html":
                path([(7,14),(4,18),(7,21)]); line(13,14,11,21); path([(17,14),(20,18),(17,21)])
            elif kind == "inline":
                line(5,15,18,15); line(5,20,14,20)

    def as_dict(self):
        return {"id": f"slide-{self.number}", "properties": {
            "slide.background": {"kind": "solid", "color": self.background},
            "notes.content": self.notes}, "objects": self.objects}


def create_deck():
    slides = []
    s = Slide(1, "产品定位", True, "ShowAI 将调研、解释和数据组织为交互网页。桌面工作台和 Agent 工具共同编辑本地项目文件。来源：README.md 开头、单页与网站交付；docs/architecture.md。右侧为产品逻辑图，非产品截图。")
    s.chrome("产品定位")
    s.text("ShowAI", 44, 118, 475, 108, 79, bold=True)
    s.text("让知识变成", 47, 244, 460, 58, 34, bold=True)
    s.text("可交互的网页", 47, 293, 460, 58, 34, bold=True)
    s.text("调研 · 解释 · 数据", 48, 380, 445, 31, 21, SAGE)
    s.text("桌面工作台 + Agent 工具", 48, 430, 445, 23, 14, "#B7CDBD")
    # A schematic of content becoming an interactive page; every mark is editable.
    s.text("内容输入", 556, 113, 132, 26, 14, SAGE)
    s.text("交互页面", 749, 113, 138, 26, 14, SAGE)
    for i,(name,kind) in enumerate((("研究资料","file"),("数据记录","chart"),("解释思路","bookmark"))):
        yy=163+i*75
        s.rect(550,yy,139,57,fill="#305D49",stroke=DARK_LINE,rounded=True)
        s.icon(kind,564,yy+17,21,SAGE)
        s.text(name,598,yy+16,82,28,14,WHITE)
    s.arrow(701,266,737,266,SAGE,1.5)
    s.rect(750,160,166,211,fill=PAPER,rounded=True)
    s.rect(750,160,166,28,fill="#38644F",rounded=True)
    for x in (763,773,783): s.circle(x,171,4,fill=ORANGE if x==763 else SAGE)
    s.line(767,204,877,204,"#50745E",3)
    s.line(767,217,852,217,"#B9C8B8",2)
    s.line(767,230,888,230,"#B9C8B8",2)
    s.line(767,294,895,294,BORDER,.8)
    s.path([(769,287),(791,280),(812,275),(834,260),(856,245),(886,229)],GREEN,2.6)
    for xx,yy in ((791,280),(834,260),(886,229)): s.circle(xx-2.5,yy-2.5,5,fill=ORANGE)
    s.rect(767,315,132,37,fill=SAGE,rounded=True)
    s.line(780,333,883,333,"#9CAD9D",2)
    s.line(780,333,844,333,GREEN,2)
    s.circle(839,328,10,fill=PAPER,stroke=GREEN,width=1.6)
    s.text("阅读 · 探索 · 分享", 599, 406, 317, 30, 17, SAGE, align="r")
    slides.append(s)

    s = Slide(2, "页面能力", notes="代表性内置能力来自 src/components/blocks/registry.ts：图表、database、playground、gallery、bookmark；自定义 React 组件来自 README.md 组件与模板。截图为仓库 docs/showai.png，原图保持不变，展示线性/平方增长与两数相乘。")
    s.chrome("页面能力", "让读者看见、比较，也能动手探索", "文字、图表、来源和交互控件，可以组合在同一页中。")
    features = [("数据图表","图表切换与原始数据","chart"),
                ("筛选表格","搜索、筛选与排序","table"),
                ("参数计算","调整参数，即时计算","slider"),
                ("图片画廊","图片、图注与全屏预览","image"),
                ("来源书签","保留论文与网页出处","bookmark"),
                ("自定义组件","扩展 React 交互","component")]
    for i,(title,desc,kind) in enumerate(features):
        col,row=i%2,i//2
        xx,yy=44+col*209,203+row*87
        s.icon(kind,xx,yy+3,24,GREEN)
        s.text(title,xx+37,yy,168,31,18,GREEN,True)
        s.text(desc,xx+37,yy+33,165,24,12,MUTED)
    s.rect(476,187,440,289,fill=WHITE,stroke=BORDER,rounded=True)
    s.add("picture","page-screenshot",488,197,416,260,**{
        "picture.asset_ref":"page-example", "picture.aspect_fit":"contain",
        "picture.crop":{"left":0.17,"right":0.17,"top":0.065,"bottom":0.135}})
    s.text("仓库示例：增长曲线与参数乘法",491,462,402,22,10,MUTED,align="ctr")
    slides.append(s)

    s = Slide(3, "共同创作", notes="来源：docs/architecture.md 数据与文件、编辑与 diff；README.md 通过 Agent 创作。App、CLI、可选 MCP 复用 Core；CLI 无需启动桌面应用。受控写入使用版本 hash 检查防止覆盖更新。操作系统外部编辑器须遵守文件写入约定，不能把它描述为无限制的实时协同。")
    s.chrome("共同创作", "人和 Agent，在同一份文件上协作", "桌面操作与 Agent 创作，共享本地项目内容。")
    for yy,title,desc,kind in ((197,"桌面工作台","编辑、预览与项目管理","person"),
                               (309,"Agent 工具","Codex / Claude / 其他 Agent","agent")):
        s.rect(44,yy,246,81,fill=WHITE,stroke=BORDER,rounded=True)
        s.icon(kind,63,yy+25,28,GREEN)
        s.text(title,111,yy+13,165,32,20,GREEN,True)
        s.text(desc,111,yy+48,170,24,11,MUTED)
    s.path([(290,237),(331,237),(331,294),(379,294)],MUTED,1.3)
    s.path([(290,349),(331,349),(331,294)],MUTED,1.3)
    s.arrow(351,294,379,294,MUTED)
    s.rect(388,223,242,145,fill=SAGE,rounded=True)
    s.icon("file",489,242,32,GREEN)
    s.text("本地项目文件",407,285,204,36,23,GREEN,True,align="ctr")
    s.text("页面 · 模板 · 组件 · 快照",404,328,209,25,12,MUTED,align="ctr")
    s.arrow(630,294,693,294,MUTED)
    s.text("内容由你掌握",713,207,203,37,23,GREEN,True)
    for i,value in enumerate(("文件可复制、备份与迁移", "Agent 可按需运行", "写入前核对内容版本")):
        yy=265+i*45
        s.circle(715,yy+7,6,fill=ORANGE)
        s.text(value,735,yy,180,28,14)
    # Incremental editing loop, represented as four evenly spaced steps.
    s.line(44,415,916,415,BORDER,1)
    for i,(title,desc) in enumerate((("读取页面","获取当前内容"),("查看差异","识别用户修改"),("局部更新","只修改相关区块"),("冲突检查","避免覆盖新版本"))):
        xx=44+i*225
        s.circle(xx,439,26,fill=GREEN)
        s.text(str(i+1),xx,441,26,24,13,WHITE,align="ctr")
        s.text(title,xx+39,430,155,30,17,GREEN,True)
        s.text(desc,xx+39,461,155,24,11,MUTED)
        if i<3: s.arrow(xx+188,452,xx+212,452,MUTED,1,4)
    slides.append(s)

    s = Slide(4, "积累与复用", notes="来源：README.md 组件与模板、发布与远程引用；docs/catalog-lifecycle.md。组件与模板按项目、全局、已发布解析；固定 id/version/integrity 引用；项目派生保留 parents；组合模板可递归引用并锁定依赖。发布须准备静态目录、自行部署、验证网址并登记；这里展示能力流程，没有宣称远程发布已完成。")
    s.chrome("积累与复用", "把一次创作，积累成下一次的起点", "组件复用交互，模板复用内容组织方式。")
    for yy,title,kind,desc1,desc2 in ((197,"组件","component","图表、筛选与参数控件","支持自定义 React 组件"),
                                    (318,"模板","file","调研、对比与简报结构","支持有序组合与递归引用")):
        s.rect(44,yy,263,97,fill=WHITE,stroke=BORDER,rounded=True)
        s.icon(kind,62,yy+23,28,GREEN)
        s.text(title,112,yy+13,169,31,21,GREEN,True)
        s.text(desc1,112,yy+46,179,23,13)
        s.text(desc2,112,yy+70,179,23,11,MUTED)
    s.path([(307,245),(347,245),(347,305),(384,305)],MUTED,1.3)
    s.path([(307,366),(347,366),(347,305)],MUTED,1.3)
    s.arrow(358,305,384,305,MUTED)
    for i,(label,desc,kind) in enumerate((("项目定制","按当前需求创作","file"),("注册全局","让其他项目复用","layers"),("登记发布","验证已部署地址","share"))):
        xx=399+i*184
        s.circle(xx,226,138,fill=SAGE if i==0 else None,stroke=BORDER,width=1)
        s.icon(kind,xx+51,250,36,GREEN)
        s.text(label,xx+4,306,130,34,21,GREEN,True,align="ctr")
        s.text(desc,xx-9,380,156,27,12,MUTED,align="ctr")
        if i<2: s.arrow(xx+149,297,xx+175,297,MUTED,1.3,5)
    s.rect(399,435,506,43,fill="#E8ECE2",rounded=True)
    s.text("固定版本引用  ·  项目派生  ·  组合模板",416,445,469,26,14,GREEN,align="ctr")
    slides.append(s)

    s = Slide(5, "分享与交付", True, "来源：README.md 单页与网站交付；docs/architecture.md 构建与交付。单 HTML 包含阅读器、内容、数据与组件，内嵌资源时可离线使用，读者无需安装 ShowAI；inline 展示依赖宿主 HTML 通道；网站须另行部署。HTML/inline 保留 .showai.json 源文件以继续编辑。应用场景来自 resources/catalog/templates.json。")
    s.chrome("分享与交付", "一份内容，三种交付方式", "完成的页面，可以走出工作台，直接交给读者。")
    outputs=[("单个 HTML","浏览器直接打开","内嵌资源，支持离线交互","html"),
             ("会话内展示","在支持 HTML 的宿主中呈现","将解释放进 Agent 对话","inline"),
             ("静态网站","多页导航与统一入口","部署到静态服务器后分享","site")]
    for i,(title,desc1,desc2,kind) in enumerate(outputs):
        xx=44+i*306
        if i>0: s.line(xx-18,204,xx-18,394,DARK_LINE,.8)
        s.text(f"0{i+1}",xx,203,60,24,12,ORANGE)
        s.icon(kind,xx+100,229,56,SAGE)
        s.text(title,xx,311,260,45,27,WHITE,True,align="ctr")
        s.text(desc1,xx-7,364,274,29,14,SAGE,align="ctr")
        s.text(desc2,xx-7,394,274,28,13,SAGE,align="ctr")
    s.line(44,449,77,449,ORANGE,3)
    s.text("论文讲解  /  方案比较  /  数据简报",93,433,633,39,20,WHITE)
    s.text("从研究到解释，从数据到决策",44,474,773,24,13,SAGE)
    slides.append(s)
    return Document.model_validate({"schema":"presentation.document.v1","id":"showai-introduction",
                                    "properties":{"document.page_size":{"width":W,"height":H}},
                                    "assets":{"page-example":{"path":"assets/interactive-page.png","content_type":"image/png"}},
                                    "pages":[s.as_dict() for s in slides]})


def check_geometry(doc):
    ids=set()
    for page in doc.pages:
        for obj in page.objects:
            if obj.id in ids: raise ValueError(f"Duplicate object id: {obj.id}")
            ids.add(obj.id)
            f=obj.properties["object.frame"]
            if f["left"]<0 or f["top"]<0 or f["left"]+f["width"]>W+.2 or f["top"]+f["height"]>H+.2:
                raise ValueError(f"Object outside slide: {obj.id}: {f}")
    if len(doc.pages)!=5: raise ValueError("Exactly five slides are required")


def contact_sheet(paths, output):
    from PIL import Image, ImageDraw, ImageFont
    thumbs=[]
    for source in paths:
        im=Image.open(source).convert("RGB")
        im.thumbnail((768,432))
        thumbs.append(im)
    sheet=Image.new("RGB",(1580,1392),"#E6E9E1")
    draw=ImageDraw.Draw(sheet)
    for i,im in enumerate(thumbs):
        x,y=16+(i%2)*790,16+(i//2)*464
        sheet.paste(im,(x,y))
        draw.text((x,y+437),f"{i+1:02d} / ShowAI",fill=GREEN)
    sheet.save(output)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=ROOT/"output/v1")
    parser.add_argument("--svg",action="store_true")
    parser.add_argument("--preview",action="store_true")
    args=parser.parse_args()
    out=args.output.resolve()
    if out.exists() and any(out.iterdir()): raise ValueError("Choose a new output version directory")
    out.mkdir(parents=True,exist_ok=True)
    for name in ("icon-design.json", "apple-icon-mask.json"):
        if BRAND_ASSETS != ROOT/"assets":
            shutil.copy2(BRAND_ASSETS/name, ROOT/"assets"/name)
    shutil.copytree(ROOT/"assets",out/"assets")
    doc=create_deck()
    check_geometry(doc)
    doc.save(out/"ShowAI.document.json")
    pptx=out/"ShowAI_项目介绍.pptx"
    report={"pptx":export_pptx(doc,pptx,asset_root=out),"validation":validate_pptx_package(pptx)}
    if args.svg: report["svg"]=export_svg(doc,out/"svg",asset_root=out)
    if args.preview:
        report["preview"]=render_pptx(pptx,out/"preview",dpi=120)
        contact_sheet(report["preview"]["slides"],out/"ShowAI_总览.png")
        shutil.copy2(report["preview"]["pdf"],out/"ShowAI_项目介绍.pdf")
    report["object_counts"]={page.id:dict(Counter(obj.kind for obj in page.objects)) for page in doc.pages}
    (out/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"pptx":str(pptx),"slides":len(doc.pages),"object_counts":report["object_counts"]},ensure_ascii=False))


if __name__=="__main__":
    main()
