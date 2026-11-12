import type { PageReferences } from "../core/library-index";
import type {
  PageReferenceItem,
  PageReferenceSource,
} from "../components/page-references";
import { desktop } from "../host/bridge";

/**
 * Reference queries of the workbench around one page. Answers come from the
 * library index; a save of any page, a page list refresh or a change from
 * another writer asks every reader to read again.
 */
export function workbenchReferenceSource(
  page: { projectId: string; pageId: string },
  subscribePages: (listener: () => void) => () => void,
): PageReferenceSource {
  const listeners = new Set<() => void>();
  let answers = new Map<
    string,
    Promise<{ items: PageReferenceItem[]; pages: number }>
  >();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let release: (() => void) | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      answers = new Map();
      for (const listener of listeners) listener();
    }, 300);
  };
  return {
    page,
    read({ projectId, pageId, direction }) {
      const key = `${projectId}/${pageId}/${direction}`;
      let answer = answers.get(key);
      if (!answer) {
        answer = desktop
          .invoke<PageReferences>("pages:references", {
            projectId,
            pageId,
            direction,
          })
          .then((result) => ({
            items: result[direction],
            pages: result.pages[direction],
          }));
        answers.set(key, answer);
        // A failed read is asked again next time.
        answer.catch(() => answers.delete(key));
      }
      return answer;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (!release) {
        const pages = subscribePages(changed);
        const files = desktop.onChange(changed);
        release = () => {
          pages();
          files();
          clearTimeout(timer);
        };
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          release?.();
          release = undefined;
        }
      };
    },
  };
}
