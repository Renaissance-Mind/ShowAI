import { Settings2 } from "../ui/icons";
import codex from "./assets/agent-brands/codex.png";
import kimi from "./assets/agent-brands/kimi.svg";
import claude from "./assets/agent-brands/claude-code.png";
import gemini from "./assets/agent-brands/gemini-cli.png";
import antigravity from "./assets/agent-brands/antigravity.png";
import opencode from "./assets/agent-brands/opencode.svg";
import openai from "../design/brands/openai.svg";
import openrouter from "./assets/agent-brands/openrouter.svg";
import deepseek from "./assets/agent-brands/deepseek.svg";
import kimiCli from "./assets/agent-brands/kimi-cli.png";
import kimiWork from "./assets/agent-brands/kimi-work.png";
import cursor from "./assets/agent-brands/cursor.png";
import qoder from "./assets/agent-brands/qoder.png";
import workbuddy from "./assets/agent-brands/workbuddy.png";
import trae from "./assets/agent-brands/trae.png";
import deepseekHarness from "./assets/agent-brands/deepseek-harness.png";

const icons = new Map([
  ["kimi-work", kimiWork],
  ["cursor", cursor],
  ["qoder", qoder],
  ["workbuddy", workbuddy],
  ["trae", trae],
  ["deepseek-harness", deepseekHarness],
  ["codex", codex],
  ["kimi", kimiCli],
  ["claude", claude],
  ["gemini", gemini],
  ["antigravity", antigravity],
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
      data-brand={brand}
      aria-hidden="true"
    >
      {icon ? <img src={icon} alt="" /> : <Settings2 size={21} />}
    </span>
  );
}
