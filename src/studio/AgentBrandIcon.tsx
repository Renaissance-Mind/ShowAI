import { Settings2 } from "../ui/icons";
import codex from "./assets/agent-brands/codex.svg";
import kimi from "./assets/agent-brands/kimi.png";
import claude from "./assets/agent-brands/claude-code.svg";
import gemini from "./assets/agent-brands/gemini-cli.svg";
import opencode from "./assets/agent-brands/opencode.svg";
import openai from "./assets/agent-brands/openai.svg";
import openrouter from "./assets/agent-brands/openrouter.svg";
import deepseek from "./assets/agent-brands/deepseek.svg";

const icons = new Map([
  ["codex", codex],
  ["kimi", kimi],
  ["claude", claude],
  ["gemini", gemini],
  ["opencode", opencode],
  ["chatgpt", openai],
  ["openai", openai],
  ["moonshot", kimi],
  ["openrouter", openrouter],
  ["deepseek", deepseek],
]);

export default function AgentBrandIcon({ brand }: { brand: string }) {
  const icon = icons.get(brand);
  return (
    <span
      className={`agent-brand-icon${icon ? "" : " agent-brand-custom"}`}
      aria-hidden="true"
    >
      {icon ? <img src={icon} alt="" /> : <Settings2 size={21} />}
    </span>
  );
}
