import { useId, useRef, useState, type ReactNode } from "react";
import type { ComponentDocumentation } from "../components/custom/documentation";
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
  const id = useId(),
    sectionsRef = useRef(new Map<string, HTMLElement>()),
    [active, setActive] = useState("purpose");
  if (!documentation)
    return (
      <div className="catalog-reading-content">
        <p>此版本尚未提供专属说明。</p>
      </div>
    );
  const { usage, reuse, development: dev } = documentation;
  const sections: { id: string; title: string; content: ReactNode }[] =
    development
      ? [
          {
            id: "entries",
            title: "实现入口",
            content: dev.entryPoints.map((entry) => (
              <p key={entry.path}>
                <code>{entry.path}</code> — {entry.purpose}
              </p>
            )),
          },
          {
            id: "architecture",
            title: "数据与实现关系",
            content: <List items={dev.architecture} />,
          },
          {
            id: "extensions",
            title: "扩展位置",
            content: <List items={dev.extensionPoints} />,
          },
          {
            id: "invariants",
            title: "必须保持的约束",
            content: <List items={dev.invariants} />,
          },
          {
            id: "verification",
            title: "验证方法",
            content: <List items={dev.verification} />,
          },
        ]
      : [
          { id: "purpose", title: "适用内容", content: <p>{usage.purpose}</p> },
          {
            id: "structure",
            title: "内容结构",
            content: <List items={usage.structure} />,
          },
          {
            id: "recipes",
            title: "使用步骤",
            content: usage.recipes.map((recipe) => (
              <details key={recipe.title} open>
                <summary>{recipe.title}</summary>
                <List items={recipe.steps} />
              </details>
            )),
          },
          {
            id: "interactions",
            title: "交互与保存",
            content: (
              <table>
                <thead>
                  <tr>
                    <th>操作</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.interactions.map((action) => (
                    <tr key={action.action}>
                      <td>{action.action}</td>
                      <td>{action.effect}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          },
          {
            id: "editing",
            title: "可调整内容",
            content: <List items={usage.editing.data} />,
          },
          {
            id: "boundaries",
            title: "适用边界",
            content: (
              <>
                <List items={reuse.boundaries} />
                <List items={usage.constraints} />
                <details>
                  <summary>修改实现</summary>
                  <List items={usage.editing.implementation} />
                </details>
              </>
            ),
          },
        ];
  return (
    <div
      className={`catalog-reading-workspace${development ? " is-development" : ""}`}
    >
      <article className="catalog-reading-main catalog-component-guide">
        {sections.map((section) => (
          <section
            key={section.id}
            id={`${id}-${section.id}`}
            ref={(element) => {
              if (element) sectionsRef.current.set(section.id, element);
              else sectionsRef.current.delete(section.id);
            }}
          >
            <h3>{section.title}</h3>
            {section.content}
          </section>
        ))}
      </article>
      {!development && (
        <aside className="catalog-info-panel catalog-document-index">
          <h3>本页</h3>
          {sections.map((section) => (
            <button
              key={section.id}
              aria-current={active === section.id ? "location" : undefined}
              onClick={() => {
                setActive(section.id);
                sectionsRef.current
                  .get(section.id)
                  ?.scrollIntoView({ block: "start", behavior: "smooth" });
              }}
            >
              {section.title}
            </button>
          ))}
        </aside>
      )}
    </div>
  );
}
