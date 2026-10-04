import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUp, File, Folder, Loader2, Plus } from "lucide-react";
import Dialog from "../studio/Dialog";
import { errorMessage } from "../studio/bridge";
import "./browser.css";

interface Entry {
  name: string;
  path: string;
  directory: boolean;
}
interface Listing {
  path: string;
  parent: string;
  separator: string;
  shortcuts: { name: string; path: string }[];
  entries: Entry[];
}
export interface FileDialogOptions {
  title: string;
  kind: "file" | "directory" | "save";
  initialPath?: string;
  defaultName?: string;
  extensions?: string[];
}
export type LocalRequest = <T>(
  route: string,
  args: Record<string, unknown>,
) => Promise<T>;

export function chooseLocalPath(
  options: FileDialogOptions,
  request: LocalRequest,
): Promise<string | null> {
  return new Promise((done) => {
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    const finish = (path: string | null) => {
      root.unmount();
      element.remove();
      done(path);
    };
    root.render(
      <FileDialog options={options} request={request} finish={finish} />,
    );
  });
}

function FileDialog({
  options,
  request,
  finish,
}: {
  options: FileDialogOptions;
  request: LocalRequest;
  finish: (path: string | null) => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [pathInput, setPathInput] = useState(options.initialPath ?? "");
  const [name, setName] = useState(options.defaultName ?? "");
  const [selected, setSelected] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const generation = useRef(0);
  const cancel = useCallback(() => finish(null), [finish]);
  const navigate = useCallback(
    async (path?: string) => {
      const ticket = ++generation.current;
      setLoading(true);
      setError("");
      setOverwrite(false);
      try {
        const next = await request<Listing>(
          "dialog/list",
          path ? { path } : {},
        );
        if (generation.current !== ticket) return;
        setListing(next);
        setPathInput(next.path);
        setSelected(null);
      } catch (reason) {
        if (generation.current === ticket) setError(errorMessage(reason));
      } finally {
        if (generation.current === ticket) setLoading(false);
      }
    },
    [request],
  );
  useEffect(() => {
    void navigate(options.initialPath);
  }, [navigate, options.initialPath]);
  const join = (name: string) =>
    listing!.path.replace(/[/\\]$/, "") + listing!.separator + name;
  const entries =
    listing?.entries.filter(
      (entry) =>
        entry.directory ||
        (options.kind !== "directory" &&
          (!options.extensions ||
            options.extensions.some((extension) =>
              entry.name.toLowerCase().endsWith(`.${extension}`),
            ))),
    ) ?? [];
  const confirm = () => {
    if (!listing || loading) return;
    if (options.kind === "directory")
      finish(selected?.directory ? selected.path : listing.path);
    else if (options.kind === "file") {
      if (selected && !selected.directory) finish(selected.path);
    } else {
      if (
        !name.trim() ||
        /[/\\\x00]/.test(name) ||
        name === "." ||
        name === ".."
      ) {
        setError("请填写文件名，文件名中不能包含路径分隔符。");
        return;
      }
      const existing = listing.entries.find((entry) => entry.name === name);
      if (existing?.directory) {
        setError("这个名称已用于文件夹，请使用其他文件名。");
        return;
      }
      if (existing && !overwrite) {
        setOverwrite(true);
        return;
      }
      finish(join(name));
    }
  };
  return (
    <Dialog
      title={options.title}
      onClose={cancel}
      wide
      className="local-file-dialog"
    >
      <div className="local-file-body">
        <form
          className="local-file-path"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate(pathInput);
          }}
        >
          <button
            className="studio-icon"
            type="button"
            aria-label="上一级目录"
            disabled={!listing || loading || listing.path === listing.parent}
            onClick={() => void navigate(listing!.parent)}
          >
            <ArrowUp size={16} />
          </button>
          <input
            aria-label="本地目录路径"
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            placeholder="输入本地目录路径"
          />
          <button className="studio-button small" disabled={loading}>
            前往
          </button>
        </form>
        <div className="local-file-shortcuts">
          {listing?.shortcuts.map((item) => (
            <button
              key={item.name}
              className="studio-button small"
              disabled={loading}
              onClick={() => void navigate(item.path)}
            >
              {item.name}
            </button>
          ))}
          <button
            className="studio-button small"
            disabled={!listing || loading}
            onClick={() => setNewFolder("")}
          >
            <Plus size={13} />
            新建文件夹
          </button>
        </div>
        {newFolder !== null && (
          <form
            className="local-file-path"
            onSubmit={(event) => {
              event.preventDefault();
              setLoading(true);
              void request<{ path: string }>("dialog/mkdir", {
                path: listing!.path,
                name: newFolder,
              })
                .then(() => {
                  setNewFolder(null);
                  return navigate(listing!.path);
                })
                .catch((reason) => {
                  setError(errorMessage(reason));
                  setLoading(false);
                });
            }}
          >
            <input
              aria-label="新文件夹名称"
              autoFocus
              value={newFolder}
              onChange={(event) => setNewFolder(event.target.value)}
            />
            <button
              className="studio-button small"
              disabled={!newFolder.trim() || loading}
            >
              创建
            </button>
            <button
              className="studio-button small"
              type="button"
              onClick={() => setNewFolder(null)}
            >
              取消
            </button>
          </form>
        )}
        <div
          className="local-file-entries"
          aria-label="本地文件列表"
          aria-busy={loading}
        >
          {loading ? (
            <div className="local-file-empty">
              <Loader2 size={20} className="studio-spin" />
              正在读取目录
            </div>
          ) : entries.length ? (
            entries.map((entry) => (
              <button
                type="button"
                key={entry.name}
                className={`local-file-entry ${selected?.path === entry.path ? "selected" : ""}`}
                aria-pressed={selected?.path === entry.path}
                onClick={() => {
                  setSelected(entry);
                  setOverwrite(false);
                  if (!entry.directory && options.kind === "save")
                    setName(entry.name);
                }}
                onDoubleClick={() => {
                  if (entry.directory) void navigate(entry.path);
                  else if (options.kind === "file") finish(entry.path);
                }}
              >
                {entry.directory ? <Folder size={17} /> : <File size={17} />}
                <span>{entry.name}</span>
              </button>
            ))
          ) : (
            <p className="local-file-empty">
              {options.kind === "directory"
                ? "没有子文件夹，可以选择当前目录"
                : "没有符合类型的文件"}
            </p>
          )}
        </div>
        {options.kind === "save" && (
          <label className="local-file-name">
            文件名
            <input
              aria-label="导出文件名"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setOverwrite(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") confirm();
              }}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="studio-form-error">
            {error}
          </p>
        )}
        {overwrite && (
          <p role="alert" className="studio-form-error">
            「{name}」已存在。继续保存将覆盖这个文件。
          </p>
        )}
        <footer className="local-file-footer">
          <span>
            {options.kind === "directory"
              ? (selected?.path ?? listing?.path)
              : selected?.name}
          </span>
          <button className="studio-button" onClick={cancel}>
            取消
          </button>
          <button
            className="studio-button primary"
            disabled={
              loading ||
              !listing ||
              (options.kind === "file" && (!selected || selected.directory)) ||
              (options.kind === "save" && !name.trim())
            }
            onClick={confirm}
          >
            {overwrite
              ? "覆盖并保存"
              : options.kind === "save"
                ? "保存"
                : options.kind === "directory"
                  ? "选择目录"
                  : "打开"}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
