import PageIcon from "./PageIcon";
import { Folder, FolderOpen } from "../ui/icons";
import {
  folderPresetFromIcon,
  type FolderIconPreset,
} from "./folder-icon-presets";

const badges = {
  briefcase: (
    <>
      <rect
        x="29"
        y="45"
        width="38"
        height="27"
        rx="4"
        fill="currentColor"
        fillOpacity={0.16}
      />
      <path d="M39 45v-5h18v5M29 55c10 5 28 5 38 0" />
      <rect
        x="44"
        y="54"
        width="8"
        height="8"
        rx="2"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  code: <path d="m41 44-11 12 11 12m14-24 11 12-11 12m-4-28-6 32" />,
  chart: (
    <>
      <path d="M27 73h42" />
      <g fill="currentColor" stroke="none">
        <rect x="29" y="55" width="10" height="12" rx="2" opacity={0.56} />
        <rect x="43" y="39" width="10" height="28" rx="2" />
        <rect x="57" y="47" width="10" height="20" rx="2" opacity={0.78} />
      </g>
    </>
  ),
  book: (
    <>
      <path
        d="M27 42c9-3 16-1 21 4v27c-5-5-12-7-21-4V42Zm42 0c-9-3-16-1-21 4v27c5-5 12-7 21-4V42Z"
        fill="currentColor"
        fillOpacity={0.16}
      />
      <path d="m33 51 9 3m-9 5 9 3m12-8 9-3m-9 11 9-3" strokeWidth={3} />
    </>
  ),
  flask: (
    <>
      <path
        d="M37 62h22l4 6c2 4-1 6-5 6H38c-4 0-7-2-5-6Z"
        fill="currentColor"
        fillOpacity={0.3}
        stroke="none"
      />
      <path d="M41 39h14M44 39v13L33 67c-2 4 1 7 5 7h20c4 0 7-3 5-7L52 52V39M37 62h22" />
      <circle cx="48" cy="56" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  camera: (
    <>
      <path
        d="M27 49h10l5-7h12l5 7h10v23H27Z"
        fill="currentColor"
        fillOpacity={0.16}
      />
      <circle cx="48" cy="60" r="7.5" />
      <path d="M59 54h4" strokeWidth={3} />
    </>
  ),
  star: (
    <path
      d="m48 36 7 13 15 2-11 10 3 14-14-7-14 7 3-14-11-10 15-2 7-13Z"
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
  bookmark: (
    <path
      d="M36 39h24v35L48 67l-12 7Z"
      fill="currentColor"
      fillOpacity={0.26}
    />
  ),
  flag: (
    <>
      <path d="M33 74V40" />
      <path
        d="M33 40h33l-8 10 8 10H33Z"
        fill="currentColor"
        fillOpacity={0.3}
      />
    </>
  ),
  bolt: (
    <path
      d="m54 36-23 24h15l-3 15 23-26H51l3-13Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  globe: (
    <>
      <circle cx="48" cy="56" r="18" fill="currentColor" fillOpacity={0.16} />
      <path d="M30 56h36M48 38c6 5 9 11 9 18s-3 13-9 18c-6-5-9-11-9-18s3-13 9-18Z" />
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
          transform="translate(12.5 15) scale(.19) translate(-48 -56)"
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
