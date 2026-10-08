#!/usr/bin/env python3
"""Reconstruct ShowAI's 3:1 banner as editable SVG and native PowerPoint."""
from __future__ import annotations

import argparse
from collections import Counter
import copy
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
INK, BLUE, GREEN, ORANGE = "#090F12", "#00ACF5", "#327B59", "#E77813"
MUTED, BORDER = "#8F999F", "#D4DBE0"
W, H = 2172, 724
CANVAS_W, CANVAS_H = 2048, 2048 / 3


def element(parent, tag, **attrs):
    return ET.SubElement(parent, f"{{{NS}}}{tag}", {
        key.replace("_", "-"): str(value) for key, value in attrs.items()
        if value is not None
    })


def group(parent, name, **attrs):
    return element(parent, "g", id=name, **attrs)


def rect(parent, x, y, w, h, fill="none", stroke=None, sw=1, rx=0, **attrs):
    return element(parent, "rect", x=x, y=y, width=w, height=h, rx=rx,
                   fill=fill, stroke=stroke, stroke_width=sw, **attrs)


def circle(parent, x, y, r, fill="none", stroke=None, sw=1, **attrs):
    return element(parent, "circle", cx=x, cy=y, r=r, fill=fill,
                   stroke=stroke, stroke_width=sw, **attrs)


def path(parent, d, stroke=None, sw=1, fill="none", **attrs):
    return element(parent, "path", d=d, stroke=stroke, stroke_width=sw,
                   fill=fill, stroke_linecap="round", stroke_linejoin="round", **attrs)


def line(parent, x1, y1, x2, y2, stroke=BORDER, sw=1, **attrs):
    return element(parent, "line", x1=x1, y1=y1, x2=x2, y2=y2,
                   stroke=stroke, stroke_width=sw, stroke_linecap="round", **attrs)


def text(parent, value, x, y, size=16, color=INK, weight=400,
         anchor="start", font="Arial", **attrs):
    node = element(parent, "text", x=x, y=y, fill=color, font_family=font,
                   font_size=size, font_weight=weight, text_anchor=anchor, **attrs)
    node.text = value
    return node


def arrow(parent, x1, y, x2, color=BLUE, sw=3, head=7):
    line(parent, x1, y, x2, y, color, sw)
    direction = 1 if x2 > x1 else -1
    path(parent, f"M{x2-direction*head},{y-head} L{x2},{y} L{x2-direction*head},{y+head}", color, sw)


def pointer(parent, x, y, color=BLUE, scale=1, name="cursor"):
    p = group(parent, name, transform=f"translate({x} {y}) scale({scale})")
    path(p, "M0,0 L8,37 L16,26 L26,39 L32,34 L22,21 L36,17 Z",
         "#FFFFFF", 3, color)
    return p


def dots(parent, name, x, y, cols, rows, dx=20, dy=21):
    g = group(parent, name)
    for col in range(cols):
        for row in range(rows):
            circle(g, x+col*dx, y+row*dy, 1.5, "#E6EBEE")


def logo(parent, source):
    """Expand the project's paint-order into editable, equivalent layers."""
    g = group(parent, "showai-logo", transform="translate(66 206) scale(0.36)")
    for node in ET.parse(source).getroot():
        if node.tag != f"{{{NS}}}rect":
            continue
        attrs = dict(node.attrib)
        if attrs.pop("paint-order", None) == "stroke fill":
            underlay = copy.deepcopy(node)
            underlay.attrib.pop("paint-order", None)
            underlay.attrib.pop("id", None)
            underlay.set("fill", "none")
            g.append(underlay)
            attrs.pop("stroke", None)
            attrs.pop("stroke-width", None)
        g.append(ET.Element(f"{{{NS}}}rect", attrs))


def create_svg(logo_source):
    root = ET.Element(f"{{{NS}}}svg", {
        "width": str(W), "height": str(H), "viewBox": f"0 0 {W} {H}",
        "role": "img", "aria-labelledby": "title description",
    })
    element(root, "title", id="title").text = "ShowAI — 构建人与 Agent 之间的 Interface。"
    element(root, "desc", id="description").text = (
        "Editable vector reconstruction of the ShowAI banner. Project logo, "
        "text, chart paths, sliders, cards and arrows are native SVG elements. "
        "Chart positions are approximated from the illustration, not measured data."
    )
    defs = element(root, "defs")
    for name, colors in [
        ("page-fill", [(0,"#FFFFFF",1),(1,"#FDFEFF",1)]),
        ("panel-fill", [(0,"#FFFFFF",1),(1,"#FCFDFE",1)]),
        ("rear-fill", [(0,"#F4FAFF",1),(1,"#F8FBFF",1)]),
        ("chart-fill", [(0,GREEN,0.13),(1,GREEN,0.015)]),
        ("green-tile", [(0,"#ECFAEF",1),(1,"#E2F4E7",1)]),
        ("blue-tile", [(0,"#EAF8FF",1),(1,"#DDF2FF",1)]),
        ("orange-tile", [(0,"#FFF3E8",1),(1,"#FFE9D7",1)]),
    ]:
        gradient = element(defs, "linearGradient", id=name, x1="0%", y1="0%", x2="0%", y2="100%")
        for offset, color, opacity in colors:
            element(gradient, "stop", offset=offset, stop_color=color, stop_opacity=opacity)
    shadow = element(defs, "filter", id="panel-shadow", x="-10%", y="-10%", width="125%", height="135%")
    element(shadow, "feDropShadow", dx=0, dy=14, stdDeviation=16,
            flood_color="#66798A", flood_opacity=0.08)
    canvas = group(root, "banner", transform=f"scale({W/CANVAS_W})")
    rect(canvas, 0, 0, CANVAS_W, CANVAS_H, "url(#page-fill)", id="background")
    dots(canvas, "dots-left", 64, 533, 8, 6)
    dots(canvas, "dots-middle-top", 792, 125, 7, 6)
    dots(canvas, "dots-middle-bottom", 774, 512, 8, 5)
    dots(canvas, "dots-right", 1905, 85, 7, 6)
    brand = group(canvas, "brand")
    logo(brand, logo_source)
    text(brand, "ShowAI", 282, 356, 138, weight=900, letter_spacing=-8, id="brand-name")
    text(brand, "构建人与 Agent 之间的 Interface。", 67, 463, 43,
         weight=600, font="Arial, PingFang SC", id="tagline")

    human = group(canvas, "human")
    circle(human, 840, 303, 43, "#FFFFFF", "#DDE3E7", 1.5)
    circle(human, 840, 294, 9, "none", INK, 2.5)
    path(human, "M824,322 C824,300 856,300 856,322", INK, 2.5)
    pointer(human, 852, 313, name="human-pointer")
    text(human, "Human", 840, 384, 24, anchor="middle", weight=500)
    links = group(canvas, "human-interface-links")
    arrow(links, 899, 289, 943)
    arrow(links, 943, 315, 899)

    app = group(canvas, "interface")
    rear = group(app, "rear-cards")
    path(rear, "M1007,73 L1728,46 Q1749,46 1749,69 L1749,490 Q1749,511 1728,512 L1007,535 Q988,535 988,514 L988,93 Q988,73 1007,73 Z",
         "#D8E7F5", 1.5, "url(#rear-fill)")
    rect(rear, 1003, 102, 808, 425, "url(#rear-fill)", "#D9E7F4", 1.5, 20)
    rect(rear, 980, 81, 809, 477, "url(#rear-fill)", "#D9E5F0", 1.5, 20)
    rect(rear, 991, 74, 794, 479, "url(#rear-fill)", "#D9E5F0", 1.5, 20)
    rect(app, 957, 96, 808, 490, "url(#panel-fill)", "#C8D2DC", 1.6, 20,
         filter="url(#panel-shadow)", id="interface-panel")
    header = group(app, "header")
    text(header, "Interface", 986, 145, 28, weight=700)
    for x in (1683, 1706, 1729):
        circle(header, x, 130, 5.8, "#D8DDE1")

    chart = group(app, "chart")
    text(chart, "y", 1005, 182, 16)
    circle(chart, 1053, 177, 4.7, GREEN)
    text(chart, "y = x²", 1065, 182, 15, MUTED)
    circle(chart, 1146, 177, 4.7, ORANGE)
    text(chart, "y = x", 1158, 182, 15, MUTED)
    x0, x1, y0, y1 = 1030, 1672, 351, 209
    for i, value in enumerate((28,21,14,7,0)):
        y = y1+(y0-y1)*i/4
        line(chart, x0, y, x1, y, "#E2E7EB", 1.1,
             stroke_dasharray="4 6" if value else None)
        text(chart, str(value), 1013, y+5, 15, MUTED, anchor="end")
    line(chart, x0, y1, x0, y0, "#DCE2E7", 1)
    green_points = [(1030,351),(1158,344.5),(1285,327),(1411,300),(1539,262),(1672,209)]
    orange_points = [(1030,351),(1158,344.5),(1285,339),(1411,333),(1539,327),(1670,319.5)]
    path(chart, "M1030,351 L1158,344.5 L1285,327 L1411,300 L1539,262 L1672,209 L1672,351 Z",
         fill="url(#chart-fill)", id="quadratic-area")
    for name, points, color in (("quadratic",green_points,GREEN),("linear",orange_points,ORANGE)):
        g = group(chart, name)
        path(g, "M" + " L".join(f"{x},{y}" for x,y in points), color, 2.4, id=f"{name}-line")
        for i,(x,y) in enumerate(points):
            circle(g, x, y, 4.5, color, "#FFFFFF", 2.4, id=f"{name}-point-{i}")
    for i in range(6):
        x = x0+(x1-x0)*i/5
        line(chart, x, y0, x, y0+4, "#DCE2E7", 1)
        text(chart, str(i), x, 378, 15, MUTED, anchor="middle")
    text(chart, "x", 1699, 371, 16)

    workflow = group(app, "workflow")
    rect(workflow, 984, 417, 62, 61, "url(#green-tile)", "#BFE9CB", 1.4, 12)
    rect(workflow, 1083, 417, 62, 61, "url(#blue-tile)", "#A8DFFF", 1.4, 12)
    rect(workflow, 1191, 417, 62, 61, "url(#orange-tile)", "#FFC6A0", 1.4, 12)
    arrow(workflow, 1047, 448, 1078, "#67B988", 2.4, 5.5)
    arrow(workflow, 1147, 448, 1184, "#517B95", 2.4, 5.5)
    file_icon = group(workflow, "document-icon")
    path(file_icon, "M1006,436 L1019,436 L1025,442 L1025,460 L1006,460 Z", GREEN, 1.8)
    path(file_icon, "M1019,436 L1019,442 L1025,442", GREEN, 1.8)
    line(file_icon, 1010, 448, 1020, 448, GREEN, 1.8)
    line(file_icon, 1010, 453, 1018, 453, GREEN, 1.8)
    share_icon = group(workflow, "share-icon")
    line(share_icon, 1106, 448, 1121, 439, BLUE, 2)
    line(share_icon, 1106, 448, 1121, 458, BLUE, 2)
    for x,y in ((1106,448),(1121,439),(1121,458)):
        circle(share_icon, x, y, 5.4, BLUE)
    bar_icon = group(workflow, "bar-icon")
    for x,y,w,h in ((1209,452,4,7),(1216,444,4,15),(1224,436,4,23)):
        rect(bar_icon, x,y,w,h,"none",ORANGE,1.8,0.8)
    line(bar_icon, 1208,459,1233,459,ORANGE,1.8)
    pointer(workflow, 1125, 457, scale=.9, name="share-pointer")
    for y,w in ((508.5,246),(528,204),(547.5,158)):
        rect(workflow,985,y-4.2,w,8.4,"#D9DCDF",rx=4.2)

    controls = group(app, "calculation-controls")
    rect(controls,1280,400,475,164,"#FFFFFF","#EDF0F3",1.1,15)
    for label,y,number,thumb,color in (("a",450,"7",1475,GREEN),("b",519,"5",1427,ORANGE)):
        slider = group(controls, f"slider-{label}")
        text(slider,label,1302,y-14,15)
        line(slider,1306,y,1538,y,"#DDE1E3",5.5)
        line(slider,1306,y,thumb,y,color,5.5)
        circle(slider,thumb,y,6.2 if label=="a" else 8.4,"#FFFFFF",color,2.5)
        rect(slider,1558,y-31.5,49,34,"#FFFFFF","#E3E7EB",1.4,6)
        text(slider,number,1582.5,y-8.5,17,"#737F85",anchor="middle")
        text(slider,"0",1302,y+26,13,MUTED)
        text(slider,"10",1533,y+26,13,MUTED,anchor="middle")
    pointer(controls,1436,524,ORANGE,.9,name="slider-pointer")
    result = group(controls,"calculation-result")
    rect(result,1627,417,115,147,"url(#panel-fill)","#E2E7EB",1.4,12)
    text(result,"a × b",1673,462,16,MUTED,anchor="middle")
    text(result,"35",1676,516,46,GREEN,700,anchor="middle")

    agent = group(canvas,"agent")
    rect(agent,1886,252,106,99,"#FFFFFF","#D1D8DE",1.7,20)
    path(agent,"M1914,287 L1934,301 L1914,316",INK,4.3)
    line(agent,1941,316,1963,316,INK,4.3)
    text(agent,"Agent",1939,387,24,anchor="middle",weight=500)
    links = group(canvas,"interface-agent-links")
    arrow(links,1798,289,1867)
    arrow(links,1867,315,1798)

    exported = group(canvas,"exported-page")
    path(exported,"M1792,477 L1850,477 Q1861,477 1861,488 L1861,539 Q1861,550 1872,550 L1900,550", "#C1C9CF",2.2)
    path(exported,"M1893,543 L1901,550 L1893,557","#98A4AC",2.2)
    rect(exported,1913,509,90,83,"#FFFFFF","#C4CCD3",1.7,9)
    line(exported,1913,528,2003,528,"#B8C1C9",1.4)
    for x in (1925,1936,1948):
        circle(exported,x,519,3.1,"#AAB4BB")
    line(exported,1947,561,1966,549,"#929DA4",1.8)
    line(exported,1947,561,1966,573,"#929DA4",1.8)
    for x,y in ((1947,561),(1966,549),(1966,573)):
        circle(exported,x,y,6.2,"#929DA4")
    return root


def flatten_transforms(root):
    """Use absolute coordinates for native import, retaining semantic groups."""
    root = copy.deepcopy(root)

    def visit(node, scale=1.0, dx=0.0, dy=0.0):
        tag = node.tag.split("}")[-1]
        if tag == "defs":
            return
        transform = node.attrib.pop("transform", "")
        for name, values in re.findall(r"(translate|scale)\(([^)]+)\)", transform):
            nums = [float(v) for v in values.replace(",", " ").split()]
            if name == "translate":
                dx += nums[0]*scale
                dy += (nums[1] if len(nums)>1 else 0)*scale
            else:
                assert len(nums)==1 or nums[0]==nums[1]
                scale *= nums[0]
        for key in ("x","x1","x2","cx"):
            if key in node.attrib:
                node.set(key,str(float(node.get(key))*scale+dx))
        for key in ("y","y1","y2","cy"):
            if key in node.attrib:
                node.set(key,str(float(node.get(key))*scale+dy))
        for key in ("width","height","r","rx","ry","stroke-width","font-size","letter-spacing"):
            if key in node.attrib:
                node.set(key,str(float(node.get(key))*scale))
        if "stroke-dasharray" in node.attrib:
            node.set("stroke-dasharray"," ".join(str(float(v)*scale) for v in node.get("stroke-dasharray").split()))
        if tag == "path":
            tokens = re.findall(r"[MLCQZ]|[-+]?(?:\d*\.\d+|\d+)",node.get("d"))
            count = 0
            parts = []
            for token in tokens:
                if token in ("M","L","C","Q","Z"):
                    parts.append(token)
                    count = 0
                else:
                    parts.append(str(float(token)*scale+(dx if count%2==0 else dy)))
                    count += 1
            node.set("d"," ".join(parts))
        for child in node:
            visit(child,scale,dx,dy)

    visit(root)
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=Path("output"))
    source_root = Path(__file__).resolve().parent
    default_logo = source_root/"assets/logo.svg"
    if not default_logo.is_file():
        default_logo = source_root.parents[1]/"src/desktop/assets/icon.svg"
    parser.add_argument("--logo",type=Path,default=default_logo)
    parser.add_argument("--skill-dir",type=Path)
    parser.add_argument("--pptx",action="store_true")
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True,exist_ok=True)
    (out/"assets").mkdir(exist_ok=True)
    shutil.copy2(args.logo,out/"assets/logo.svg")
    root = create_svg(out/"assets/logo.svg")
    ET.indent(root)
    svg = out/"result.svg"
    ET.ElementTree(root).write(svg,encoding="utf-8",xml_declaration=True)
    subprocess.run(["rsvg-convert",str(svg),"--output",str(out/"preview.png")],check=True)
    notes = (
        "# ShowAI Banner 可编辑重建\n\n"
        "尺寸为 2172 × 724，比例 3:1。对照仓库 docs/showai-banner.png 重建，"
        "logo 使用 src/desktop/assets/icon.svg，并保留项目 logo 的矢量矩形与层叠顺序。\n\n"
        "标题、标语、标签、数字均为文字；卡片、连线、图标、鼠标指针、曲线与滑杆"
        "均为原生矢量图形，并按品牌、Human、Interface、Agent 和子图分组。"
        "不含原图截图或位图素材。文字使用 Arial 与 PingFang SC。\n\n"
        "这是原图的结构化重建，字体、阴影和微小间距存在近似。图表点位来自"
        "原图可见位置，缺少原始数据；曲线是可编辑路径，不能据此恢复精确实验数据。"
        "PowerPoint 中滑杆与按钮是可编辑的示意图形。\n\n"
        "修改 result.svg 可编辑文本与图形；build.py 可重新生成。PPTX 中可以进入或"
        "取消分组后分别修改原生文字与形状。实际 PPTX 预览位于 pptx-preview/。\n"
    )
    (out/"notes.md").write_text(notes)
    if args.pptx:
        skill = args.skill_dir
        if skill is None:
            skill = source_root/"toolkit/drawai-ppt"
        if not skill.is_dir() and os.environ.get("SKILL_DIR"):
            skill = Path(os.environ["SKILL_DIR"])
        if not (skill/"scripts/pptx_skill").is_dir():
            parser.error("Provide the installed DrawAI PPT toolkit with --skill-dir or SKILL_DIR")
        sys.path.insert(0,str(skill/"scripts"))
        from pptx_skill import import_svg, export_pptx, render_pptx, validate_pptx_package
        # Flatten affine transforms before native SVG import to keep nested
        # groups' positions stable through the toolkit's PPTX round trip.
        pptx_svg = out/"pptx-input.svg"
        ET.ElementTree(flatten_transforms(root)).write(pptx_svg,encoding="utf-8",xml_declaration=True)
        doc, conversion = import_svg(pptx_svg)
        def fix_text(objects):
            for obj in objects:
                if obj.kind == "text_box":
                    paragraphs = obj.properties["text.body.paragraphs"]
                    runs = [r for p in paragraphs for r in p["content"] if r.get("kind")=="run"]
                    value = "".join(r.get("text","") for r in runs)
                    size = runs[0]["properties"]["text.run.font.size"]
                    obj.properties["object.frame"]["top"] -= size*.14
                    if paragraphs[0].get("properties",{}).get("text.paragraph.alignment") == "l":
                        obj.properties["object.frame"]["left"] += size*.1
                    for run in runs:
                        props = run["properties"]
                        props["text.run.font.east_asian"] = "PingFang SC"
                        if value == "ShowAI":
                            props["text.run.letter_spacing"] = -8*(W/CANVAS_W)*.75
                if obj.children:
                    fix_text(obj.children)
        fix_text(doc.pages[0].objects)
        doc.properties["document.page_size"] = {"width":W*.75,"height":H*.75}
        doc.pages[0].properties["notes.content"] = notes
        doc.save(out/"document.json")
        pptx = out/"ShowAI-Banner-editable.pptx"
        export = export_pptx(doc,pptx)
        validation = validate_pptx_package(pptx)
        rendering = render_pptx(pptx,out/"pptx-preview")
        with zipfile.ZipFile(pptx) as z:
            slide = ET.fromstring(z.read("ppt/slides/slide1.xml"))
            kinds = Counter(node.tag.split("}")[-1] for node in slide.iter())
            editable_text = [n.text for n in slide.iter() if n.tag.endswith("}t")]
            media = [n for n in z.namelist() if n.startswith("ppt/media/")]
        assert kinds["pic"] == 0, "Banner must contain only native editable objects"
        assert "ShowAI" in editable_text and "35" in editable_text
        report = {"conversion":conversion,"export":export,"validation":validation,
                  "rendering":rendering,"editability":{"native_shapes":kinds["sp"],
                  "native_groups":kinds["grpSp"],"picture_objects":kinds["pic"],
                  "text_runs":editable_text,"media_parts":media},
                  "size_pixels":[W,H],"reference":"docs/showai-banner.png",
                  "logo":"src/desktop/assets/icon.svg",
                  "limitations":["Approximate font metrics and shadow","Chart positions reconstructed from illustration"]}
        (out/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2,default=str))
    assert root.get("viewBox") == "0 0 2172 724"
    assert not list(root.iter(f"{{{NS}}}image"))
    sentinel = {"success":True,"final":True,"svg":str(args.output/"result.svg"),
                "preview":str(args.output/"preview.png"),"notes":str(args.output/"notes.md"),"used_tools":["svg"],
                "used_source_crops":False,"used_full_page_background":False,"errors":[]}
    (out/"agent-result.json").write_text(json.dumps(sentinel,indent=2))
    print(json.dumps({"output":str(out),"svg":str(svg),"pptx":args.pptx}))


if __name__ == "__main__":
    main()
