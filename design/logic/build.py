#!/usr/bin/env python3
"""Build localized editable ShowAI design diagrams from one SVG layout."""
import argparse
import copy
from functools import lru_cache
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

from PIL import ImageFont

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from svg_logo import logo_elements
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
DATA = json.loads((ROOT / "locales.json").read_text())
LANGUAGES = [k for k in DATA if k != "keys"]
WIDTHS = {
    "组件": 228, "文本": 113, "图片": 113, "表格": 113, "图表": 113,
    "流程图": 113, "滑块": 113, "Agent 可动态添加": 268,
    "内容（模板）": 335, "模板": 148, "应用": 110, "提炼": 110,
    "Page · 顺序阅读": 166, "Board · 空间探索": 220, "共同创作": 383,
    "Agent 上下文": 337, "直接查看与使用": 337, "帮我看看这组数据": 222,
    "趋势与对比": 327, "参数：7": 105, "再比较另一组数据": 179,
    "像笔记软件一样编辑与管理": 337, "使用与交付": 241,
    "源 JSON": 116, "局部导出": 116, "独立 HTML": 116,
    "静态 Site": 116, "阅读 · 交互 · 分享": 278,
}


@lru_cache(maxsize=None)
def font(family, bold, size):
    face = subprocess.check_output([
        "fc-match", "-f", "%{file}\n%{index}",
        f"{family}:style={'Bold' if bold else 'Regular'}",
    ], text=True).strip().splitlines()
    index = int(face[1]) % 65536 if len(face)>1 else 0
    return ImageFont.truetype(face[0], size=size, index=index)


def width(value, size, locale, bold):
    latin = font("Arial", bold, 1000)
    cjk = font(locale["cjk_font"], bold, 1000)
    # Match the declared Latin-first fallback order in the SVG.
    return sum((cjk if ord(c)>=0x2E80 else latin).getlength(c) for c in value)*size/1000


def build(language):
    locale = DATA[language]
    assert len(locale["labels"]) == len(DATA["keys"])
    labels = dict(zip(DATA["keys"], locale["labels"]))
    root = copy.deepcopy(ET.parse(ROOT / "source.svg").getroot())
    logo = root.find(f".//{{{NS}}}g[@id='showai-app-logo']")
    if logo is None:
        raise ValueError("The design layout must contain showai-app-logo.")
    logo[:] = logo_elements(ROOT.parents[1] / "src/desktop/assets/icon.svg", "showai-app-logo")
    root.set("lang", language)
    root.set("{http://www.w3.org/XML/1998/namespace}lang", language)
    root.find(f"{{{NS}}}title").text = locale["title"]
    root.find(f"{{{NS}}}desc").text = locale["description"]
    for group in root.iter(f"{{{NS}}}g"):
        if "font-family" in group.attrib:
            group.set("font-family", locale["font"])
    translated = set()
    fits = []
    for text in root.iter(f"{{{NS}}}text"):
        key = text.text
        if key not in labels:
            assert key in {"1","2","3","4","35","{ }","ShowAI App"}, key
            continue
        translated.add(key)
        text.set("data-label", key)
        value = labels[key]
        lines = value.split("\n")
        size = float(text.get("font-size"))
        bold = float(text.get("font-weight",400))>=600
        measured = max(width(line,size,locale,bold) for line in lines)
        if measured > WIDTHS[key]:
            size = round(size*WIDTHS[key]/measured*.97,1)
            text.set("font-size",str(size))
        text.text = value if len(lines)==1 else None
        if len(lines)>1:
            start = float(text.get("y")) - size*.60*(len(lines)-1)
            for i,line in enumerate(lines):
                span = ET.SubElement(text,f"{{{NS}}}tspan",{
                    "x":text.get("x"),"y":str(round(start+i*size*1.15,2)),
                })
                span.text = line
        fits.append({"label":key,"translation":value,"font_size":size,
                     "width":round(max(width(line,size,locale,bold) for line in lines),2),
                     "available_width":WIDTHS[key]})
    assert translated == set(labels)
    assert not list(root.iter(f"{{{NS}}}image"))
    return root,fits


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language",choices=["all",*LANGUAGES],default="all")
    parser.add_argument("--output-dir",type=Path,default=ROOT.parents[1]/"docs")
    parser.add_argument("--preview-dir",type=Path)
    args=parser.parse_args()
    reports=[]
    for language in LANGUAGES if args.language=="all" else [args.language]:
        root,fits=build(language)
        file=args.output_dir/"showai-design-logic.svg" if language=="en" else args.output_dir/"i18n"/f"showai-design-logic.{language}.svg"
        file.parent.mkdir(parents=True,exist_ok=True)
        ET.indent(root)
        ET.ElementTree(root).write(file,encoding="utf-8",xml_declaration=True)
        if args.preview_dir:
            args.preview_dir.mkdir(parents=True,exist_ok=True)
            subprocess.run(["rsvg-convert",str(file),"--output",str(args.preview_dir/f"{language}.png")],check=True)
        reports.append({"language":language,"svg":str(file),"labels":fits})
    if args.preview_dir:
        (args.preview_dir/"report.json").write_text(json.dumps(reports,ensure_ascii=False,indent=2))
    print(json.dumps({"diagrams":len(reports),"languages":[r['language'] for r in reports]}))


if __name__=="__main__":
    main()
