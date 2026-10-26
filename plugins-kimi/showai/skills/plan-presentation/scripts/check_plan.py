#!/usr/bin/env python3
"""Check saved presentation-plan coverage (logic nodes and design scenes); this is not a quality score."""
import hashlib
import argparse
import json
import sys
from pathlib import Path


def check(plan, document=None):
    errors, nodes, scenes, covered = [], {}, {}, set()

    def need(record, keys, label):
        if not isinstance(record, dict):
            errors.append(f"{label}: expected an object")
            return False
        for key in keys:
            if not isinstance(record.get(key), str) or not record[key].strip():
                errors.append(f"{label}.{key}: required text")
        return True

    if not need(plan, ["reader", "startingKnowledge", "goal", "cutoff"], "plan"):
        return {"ok": False, "errors": errors}
    environment = plan.get("environment")
    if not isinstance(environment, dict):
        errors.append("environment: object with width, height and interactive required")
        environment = {}
    for key in ["width", "height"]:
        if not isinstance(environment.get(key), int) or environment[key] <= 0:
            errors.append(f"environment.{key}: positive CSS viewport size required")
    if not isinstance(environment.get("interactive"), bool):
        errors.append("environment.interactive: boolean required")

    def walk(branches, depth=1):
        if not isinstance(branches, list):
            errors.append("nodes/children must be arrays")
            return
        for node in branches:
            if not need(node, ["id", "task", "answer", "check"], "node"):
                continue
            key = node.get("id")
            if not isinstance(key, str):
                continue
            if key in nodes:
                errors.append(f"duplicate node: {key}")
            nodes[key] = (node, depth)
            if not isinstance(node.get("needs", []), list):
                errors.append(f"{key}.needs must be an array of prerequisite ids")
            children = node.get("children", [])
            if not children:
                need(node, ["explanation"], key)
            walk(children, depth + 1)

    walk(plan.get("nodes", []))
    if not nodes:
        errors.append("no logic nodes")
    raw_scenes = plan.get("scenes", [])
    if not isinstance(raw_scenes, list):
        errors.append("scenes must be an array")
        raw_scenes = []
    for scene in raw_scenes:
        if not need(scene, ["id", "form", "composition", "visualReason", "static", "narrow", "check"], "scene"):
            continue
        key = scene.get("id")
        if not isinstance(key, str):
            continue
        if key in scenes:
            errors.append(f"duplicate scene: {key}")
        scenes[key] = scene
        links = scene.get("nodes", [])
        if not isinstance(links, list) or not links:
            errors.append(f"{key}: link the logic nodes explained here")
            continue
        for link in links:
            if not isinstance(link, str):
                errors.append(f"{key}: node references must be strings")
                continue
            if link not in nodes:
                errors.append(f"{key}: unknown node {link}")
            covered.add(link)
        if scene.get("interaction"):
            need(scene["interaction"], ["trigger", "change", "reset"], f"{key}.interaction")
    for key, (node, _) in nodes.items():
        if key not in covered:
            errors.append(f"{key}: no scene explains this node")
        for prerequisite in node.get("needs", []) if isinstance(node.get("needs", []), list) else []:
            if not isinstance(prerequisite, str) or prerequisite not in nodes or prerequisite == key:
                errors.append(f"{key}: invalid prerequisite {prerequisite}")
    visited, active = set(), set()

    def visit(key):
        if not isinstance(key, str) or key not in nodes:
            return
        if key in active:
            errors.append(f"prerequisite cycle at {key}")
            return
        if key in visited:
            return
        active.add(key)
        needs = nodes[key][0].get("needs", [])
        for dep in needs if isinstance(needs, list) else []:
            visit(dep)
        active.remove(key)
        visited.add(key)

    for key in nodes:
        visit(key)
    source_blocks = set()
    if document is not None:
        if isinstance(document.get("data"), dict):
            document = document["data"]
        document = document.get("document", document)
        def collect(node):
            if not isinstance(node, dict):
                return
            identifier = node.get("attrs", {}).get("id")
            if identifier:
                source_blocks.add(identifier)
            for child in node.get("content", []) if isinstance(node.get("content", []), list) else []:
                collect(child)
        collect(document.get("content"))
        if not source_blocks:
            errors.append("page: no source block IDs found")
        for key, scene in scenes.items():
            references = scene.get("blockIds")
            if not isinstance(references, list) or not references:
                errors.append(f"{key}: final review requires blockIds from the saved page")
                continue
            for reference in references:
                if not isinstance(reference, str) or reference not in source_blocks:
                    errors.append(f"{key}: unknown saved-page block {reference}")
    return {"ok": not errors, "errors": errors, "nodeCount": len(nodes),
            "maxDepth": max((d for _, d in nodes.values()), default=0),
            "sceneCount": len(scenes),
            "sourceMappingChecked": document is not None,
            "scope": "Structural coverage and optional source references only; inspect semantic agreement and the rendered result."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan")
    parser.add_argument("--page", help="Saved page_read JSON or .showai.json for final scene mapping")
    args = parser.parse_args()
    content = Path(args.plan).read_bytes()
    page = Path(args.page).read_bytes() if args.page else None
    result = check(json.loads(content), json.loads(page) if page else None)
    result["sha256"] = hashlib.sha256(content).hexdigest()
    if page:
        result["sourceSha256"] = hashlib.sha256(page).hexdigest()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result["ok"] else 1)
