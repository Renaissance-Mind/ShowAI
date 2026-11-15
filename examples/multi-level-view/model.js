export function buildLevels(data, renderers) {
  const levels = new Map(data.levels.map((level) => [level.id, level]));
  if (levels.size !== data.levels.length) throw new Error("层级 ID 必须唯一");
  const root = levels.get(data.root);
  if (!root || root.parentId !== null)
    throw new Error("root 必须指向唯一的根视图");
  for (const level of levels.values()) {
    if (level.id !== data.root && !levels.has(level.parentId))
      throw new Error(`父视图不存在：${level.id}`);
    if (level.id !== data.root && level.parentId === null)
      throw new Error("只能有一个根视图");
    const seen = new Set();
    let item = level;
    while (item) {
      if (seen.has(item.id)) throw new Error(`层级循环：${item.id}`);
      seen.add(item.id);
      item = levels.get(item.parentId);
    }
  }
  for (const level of levels.values()) {
    const renderer = renderers?.[level.component.kind];
    if (renderers && !renderer)
      throw new Error(`未注册的组件：${level.component.kind}`);
    const targets = renderer?.targets(level.component.props) || [];
    const sources = new Set();
    for (const binding of level.bindings) {
      const key = JSON.stringify([
        binding.source.type,
        binding.source.scope,
        binding.source.id,
      ]);
      if (sources.has(key))
        throw new Error(`同一对象重复绑定：${level.id}/${binding.source.id}`);
      sources.add(key);
      const child = levels.get(binding.to);
      if (!child || child.parentId !== level.id)
        throw new Error(`事件必须进入直接子视图：${level.id} → ${binding.to}`);
      if (
        renderer &&
        !targets.some((target) => sameTarget(target, binding.source))
      )
        throw new Error(`绑定对象不存在：${level.id}/${binding.source.id}`);
    }
  }
  for (const child of levels.values()) {
    if (
      child.parentId &&
      !levels
        .get(child.parentId)
        .bindings.some((binding) => binding.to === child.id)
    )
      throw new Error(`子视图没有进入事件：${child.id}`);
  }
  return levels;
}
export function sameTarget(a, b) {
  return a.type === b.type && a.scope === b.scope && a.id === b.id;
}
export function levelPath(levels, id) {
  const path = [];
  while (levels.has(id)) {
    const level = levels.get(id);
    path.unshift(level);
    id = level.parentId;
  }
  return path;
}
