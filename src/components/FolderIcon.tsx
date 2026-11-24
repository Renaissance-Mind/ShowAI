import PageIcon from "./PageIcon";
import { Folder, FolderOpen } from "../ui/icons";
import {
  folderPresetFromIcon,
  type FolderIconPreset,
} from "./folder-icon-presets";

const badges = {
  briefcase: (
    <>
      <rect x="32" y="43" width="32" height="27" rx="4" />
      <path d="M40 43v-6h16v6M32 53c9 5 23 5 32 0M48 52v5" />
    </>
  ),
  code: <path d="m42 44-9 11 9 11M54 44l9 11-9 11M51 40l-6 30" />,
  chart: <path d="M31 70h36M35 66V55M48 66V43M61 66V51" />,
  book: (
    <path d="M28 42c8-3 15-1 20 4v27c-5-5-12-7-20-4V42Zm40 0c-8-3-15-1-20 4v27c5-5 12-7 20-4V42Z" />
  ),
  flask: (
    <path d="M41 39h14M44 39v13L33 67c-2 4 1 7 5 7h20c4 0 7-3 5-7L52 52V39M39 61h18" />
  ),
  camera: (
    <>
      <path d="M29 48h9l4-7h13l4 7h9v25H29V48Z" />
      <circle cx="48" cy="59" r="8" />
    </>
  ),
  star: (
    <path
      d="m48 35 7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2 7-14Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  heart: (
    <path
      d="M48 75S27 63 27 49c0-12 15-16 21-6 6-10 21-6 21 6 0 14-21 26-21 26Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  bookmark: <path d="M37 36h22v39L48 66l-11 9V36Z" />,
  flag: <path d="M34 76V36M37 39h28l-7 11 7 11H37" />,
  bolt: (
    <path
      d="m53 33-21 28h14l-3 19 22-31H51l2-16Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  globe: (
    <>
      <circle cx="48" cy="56" r="21" />
      <path d="M27 56h42M48 35c8 8 11 15 11 21s-3 13-11 21c-8-8-11-15-11-21s3-13 11-21Z" />
    </>
  ),
};

type FolderIconAppearance = {
  open?: boolean;
  size?: number;
  strokeWidth?: number;
};

export function FolderIconGlyph({
  preset,
  open = false,
  size = 18,
  strokeWidth = 1.7,
}: FolderIconAppearance & {
  preset?: FolderIconPreset;
}) {
  const Outline = open ? FolderOpen : Folder;
  return (
    <Outline
      size={size}
      strokeWidth={strokeWidth}
      color={preset?.color}
      aria-hidden="true"
    >
      {preset?.symbol && (
        <g
          transform="translate(12 15.25) scale(.18) translate(-48 -56)"
          color={preset.color}
          strokeWidth={4}
        >
          {badges[preset.symbol]}
        </g>
      )}
    </Outline>
  );
}

export default function FolderIcon({
  value,
  open,
  size = 18,
  strokeWidth,
}: FolderIconAppearance & {
  value?: string;
}) {
  const preset = folderPresetFromIcon(value);
  return (
    <PageIcon
      value={preset ? undefined : value}
      size={size}
      fallback={
        <FolderIconGlyph
          preset={preset}
          size={size}
          open={open}
          strokeWidth={strokeWidth}
        />
      }
    />
  );
}
