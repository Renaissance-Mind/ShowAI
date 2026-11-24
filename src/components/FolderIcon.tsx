import PageIcon from "./PageIcon";
import { Folder, FolderOpen } from "../ui/icons";
import {
  readFolderIconStyle,
  type FolderBadge,
  type FolderBadgeBackground,
  type FolderIconStyle,
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

const neutral = "#7c8492";
const emojiFont =
  "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const folderFace = { x: 8, y: 25, width: 82, height: 57, rx: 9 };
const faceCenter = {
  x: folderFace.x + folderFace.width / 2,
  y: folderFace.y + folderFace.height / 2,
};
const badgeSize = 46;
const faceBottom = folderFace.y + folderFace.height;
// Anchor the opening face at its lower-left corner so the badge moves with it.
const openFaceTransform = `translate(${folderFace.x} ${faceBottom}) matrix(.86 0 -.28 .78 0 0) translate(${-folderFace.x} ${-faceBottom})`;

export function folderBadgeFill(
  background: FolderBadgeBackground | undefined,
  color: string,
) {
  if (background === "white") return "#fffaf3";
  if (background === "adaptive")
    return `color-mix(in srgb, ${color || neutral}, white 84%)`;
  return undefined;
}

function BadgeArtwork({
  badge,
  color,
  x,
  y,
  scale,
}: {
  badge: FolderBadge;
  color: string;
  x: number;
  y: number;
  scale: number;
}) {
  if (badge.kind === "emoji") {
    const count = Array.from(segmenter.segment(badge.value)).length;
    return (
      <text
        x={x}
        y={y + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily={emojiFont}
        fontSize={(46 * scale) / Math.max(1, count)}
        fill={color}
      >
        {badge.value}
      </text>
    );
  }
  return (
    <g
      transform={`translate(${x} ${y}) scale(${scale}) translate(-48 -56)`}
      color={color}
      fill="none"
      stroke={color}
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {badges[badge.value]}
    </g>
  );
}

export function FolderBadgeGlyph({
  badge,
  color,
  size = 24,
}: {
  badge: FolderBadge;
  color: string;
  size?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 96 96"
      aria-hidden="true"
    >
      <BadgeArtwork badge={badge} color={color} x={48} y={48} scale={1.6} />
    </svg>
  );
}

export function FolderIconGlyph({
  composition,
  open = false,
  size = 18,
  strokeWidth = 1.7,
}: FolderIconAppearance & {
  composition?: FolderIconStyle;
}) {
  const paint = composition?.color || neutral;
  const ink = `color-mix(in srgb, ${paint}, #1f2937 50%)`;
  if (composition?.mode === "standalone" && composition.badge) {
    return (
      <FolderBadgeGlyph
        badge={composition.badge}
        color={composition.color || "currentColor"}
        size={size}
      />
    );
  }
  if (!composition?.color && !composition?.badge) {
    const Outline = open ? FolderOpen : Folder;
    return <Outline size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  }

  const face = `color-mix(in srgb, ${paint}, white 40%)`;
  const back = `color-mix(in srgb, ${paint}, white 20%)`;
  const badgeFill = folderBadgeFill(composition.badgeBackground, paint);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 96 96"
      aria-hidden="true"
    >
      <path
        d={`M8 24a9 9 0 0 1 9-9h17a10 10 0 0 1 7 3l7 7h${open ? 21 : 33}a9 9 0 0 1 9 9v39a9 9 0 0 1-9 9H17a9 9 0 0 1-9-9Z`}
        fill={open ? back : face}
      />
      {(open || composition.badge) && (
        <g data-folder-face="" transform={open ? openFaceTransform : undefined}>
          {open && <rect {...folderFace} fill={face} />}
          {composition.badge && (
            <g data-folder-badge="">
              {badgeFill && (
                <rect
                  x={faceCenter.x - badgeSize / 2}
                  y={faceCenter.y - badgeSize / 2}
                  width={badgeSize}
                  height={badgeSize}
                  rx={13}
                  fill={badgeFill}
                />
              )}
              <BadgeArtwork
                badge={composition.badge}
                color={ink}
                x={faceCenter.x}
                y={faceCenter.y}
                scale={0.86}
              />
            </g>
          )}
        </g>
      )}
    </svg>
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
  const composition = readFolderIconStyle(value);
  return (
    <PageIcon
      value={composition ? undefined : value}
      size={size}
      fallback={
        <FolderIconGlyph
          composition={composition}
          size={size}
          open={open}
          strokeWidth={strokeWidth}
        />
      }
    />
  );
}
