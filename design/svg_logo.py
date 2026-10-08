"""Read the canonical ShowAI icon as editable vector paint layers."""
import copy
import xml.etree.ElementTree as ET

NS = "http://www.w3.org/2000/svg"


def logo_elements(source, prefix="showai-logo"):
    elements = []
    for original in ET.parse(source).getroot():
        tag = original.tag.split("}")[-1]
        if tag in {"title", "desc", "metadata"}:
            continue
        if tag not in {"rect", "path", "circle", "ellipse", "polygon", "polyline", "line"}:
            raise ValueError(f"Unsupported logo element: {tag}")
        node = copy.deepcopy(original)
        if node.get("id"):
            node.set("id", f"{prefix}-{node.get('id')}")
        if node.attrib.pop("paint-order", None) == "stroke fill":
            underlay = copy.deepcopy(node)
            underlay.attrib.pop("id", None)
            underlay.set("fill", "none")
            elements.append(underlay)
            node.attrib.pop("stroke", None)
            node.attrib.pop("stroke-width", None)
        elements.append(node)
    return elements
