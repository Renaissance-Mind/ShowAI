/**
 * Printing a page to PDF. The offline reader renders the page; these
 * additions travel with the printed copy only, so the reader bundle and
 * HTML exports stay as they are.
 */

/** Keeps components, figures and tables whole on a sheet where they fit. */
export const PRINT_CSS = `@page{margin:16mm 14mm}
@media print{
html,body{background:#fff!important}
.portable-widget,[data-component-kind],[data-surface-content],.surface-object,figure,table,pre,blockquote,img,iframe,svg,.portable-callout,.code-block,.portable-task,li{break-inside:avoid;page-break-inside:avoid}
h1,h2,h3,h4,h5,h6{break-after:avoid;page-break-after:avoid}
p{orphans:3;widows:3}
}`;

/**
 * An expression that resolves once the page has settled: fonts and images
 * loaded and nothing has changed for a moment, so components that compile or
 * measure themselves print as they show. It gives up after 20 seconds.
 */
export const SETTLE_SCRIPT = `(async()=>{const deadline=Date.now()+20000;if(document.fonts)await document.fonts.ready;let last=Date.now();const observer=new MutationObserver(()=>{last=Date.now()});observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});const pending=()=>[...document.images].some(image=>!image.complete)||!!document.querySelector('[data-cubic-pending]');while(Date.now()<deadline&&(Date.now()-last<700||pending()))await new Promise(done=>setTimeout(done,100));observer.disconnect();return true})()`;

/**
 * The reader HTML prepared for printing. With `autoPrint`, the page opens
 * the print dialog itself once settled and closes after printing, which is
 * how a browser saves it as PDF.
 */
export function printableHtml(html: string, options: { autoPrint: boolean }) {
  const style = `<style data-showai-print>${PRINT_CSS}</style>`;
  const withStyle = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${style}</head>`)
    : style + html;
  if (!options.autoPrint) return withStyle;
  const script = `<script>addEventListener("load",()=>{${SETTLE_SCRIPT}.then(()=>{addEventListener("afterprint",()=>close());print()})})</script>`;
  const index = withStyle.search(/<\/body>(?![\s\S]*<\/body>)/i);
  return index < 0
    ? withStyle + script
    : withStyle.slice(0, index) + script + withStyle.slice(index);
}
