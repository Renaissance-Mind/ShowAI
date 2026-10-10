import type { ComponentDocumentation } from "../components/custom/documentation";
import { reuseLabels } from "../components/custom/documentation";

const List = ({ items }: { items: string[] }) => (
  <ul>
    {items.map((text, i) => (
      <li key={i}>{text}</li>
    ))}
  </ul>
);
export default function ComponentDocumentationView({
  documentation,
  development = false,
}: {
  documentation?: ComponentDocumentation;
  development?: boolean;
}) {
  if (!documentation)
    return (
      <p className="catalog-reference-intro">
        此旧版本尚未提供专属说明，复用范围待评估。请查看参数与示例；修改实现前检查精确版本的源码。
      </p>
    );
  const { usage, reuse } = documentation;
  const dev = documentation.development;
  return (
    <article className="catalog-component-guide">
      <header>
        <strong>{reuseLabels[reuse.kind]}</strong>
        {reuse.owner && <p>所属作品／用途：{reuse.owner}</p>}
      </header>
      <section>
        <h3>适用边界</h3>
        <List items={reuse.boundaries} />
      </section>
      {development ? (
        <>
          <section>
            <h3>实现入口</h3>
            {dev.entryPoints.map((entry) => (
              <p key={entry.path}>
                <code>{entry.path}</code> — {entry.purpose}
              </p>
            ))}
          </section>
          <section>
            <h3>数据与实现关系</h3>
            <List items={dev.architecture} />
          </section>
          <section>
            <h3>扩展位置</h3>
            <List items={dev.extensionPoints} />
          </section>
          <section>
            <h3>必须保持的约束</h3>
            <List items={dev.invariants} />
          </section>
          <section>
            <h3>验证方法</h3>
            <List items={dev.verification} />
          </section>
        </>
      ) : (
        <>
          <p>{usage.purpose}</p>
          <section>
            <h3>如何组织内容</h3>
            <List items={usage.structure} />
          </section>
          <section>
            <h3>输入与参数</h3>
            <dl>
              {usage.inputs.map((input) => (
                <div key={input.path}>
                  <dt>
                    <code>{input.path}</code>
                  </dt>
                  <dd>{input.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>使用步骤</h3>
            {usage.recipes.map((recipe) => (
              <details key={recipe.title} open>
                <summary>{recipe.title}</summary>
                <List items={recipe.steps} />
                {recipe.exampleIndex !== undefined && (
                  <p>对应“概览”中的第 {recipe.exampleIndex + 1} 个示例。</p>
                )}
              </details>
            ))}
          </section>
          <section>
            <h3>交互与保存</h3>
            {usage.interactions.map((action) => (
              <p key={action.action}>
                <strong>{action.action}</strong>：{action.effect}
              </p>
            ))}
          </section>
          <section>
            <h3>限制与检查</h3>
            <List items={usage.constraints} />
          </section>
          <section>
            <h3>可通过数据修改</h3>
            <List items={usage.editing.data} />
          </section>
          <section>
            <h3>需要修改实现</h3>
            <List items={usage.editing.implementation} />
          </section>
        </>
      )}
    </article>
  );
}
