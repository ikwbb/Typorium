// MathJax 4 (TeX in, SVG out) with the New Computer Modern font, bundled for
// offline use. Loaded lazily the first time a formula is rendered.
import { mathjax } from "@mathjax/src/mjs/mathjax.js";
import { TeX } from "@mathjax/src/mjs/input/tex.js";
import { SVG } from "@mathjax/src/mjs/output/svg.js";
import { browserAdaptor } from "@mathjax/src/mjs/adaptors/browserAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/mjs/handlers/html.js";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";
import "@mathjax/src/mjs/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/mjs/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/mjs/input/tex/configmacros/ConfigMacrosConfiguration.js";
import "@mathjax/src/mjs/input/tex/textmacros/TextMacrosConfiguration.js";
import "@mathjax/src/mjs/input/tex/color/ColorConfiguration.js";
import "@mathjax/src/mjs/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/mjs/input/tex/mhchem/MhchemConfiguration.js";
import "@mathjax/src/mjs/input/tex/noerrors/NoErrorsConfiguration.js";
import "@mathjax/src/mjs/input/tex/noundefined/NoUndefinedConfiguration.js";
import "@mathjax/src/mjs/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/mjs/input/tex/cancel/CancelConfiguration.js";
import "@mathjax/src/mjs/input/tex/physics/PhysicsConfiguration.js";
import "@mathjax/src/mjs/input/tex/braket/BraketConfiguration.js";
import "@mathjax/src/mjs/input/tex/bbox/BboxConfiguration.js";
import "@mathjax/src/mjs/input/tex/enclose/EncloseConfiguration.js";
import "@mathjax/src/mjs/input/tex/unicode/UnicodeConfiguration.js";
import "@mathjax/src/mjs/input/tex/upgreek/UpgreekConfiguration.js";
import "@mathjax/src/mjs/input/tex/gensymb/GensymbConfiguration.js";
import "@mathjax/src/mjs/input/tex/cases/CasesConfiguration.js";
import "@mathjax/src/mjs/input/tex/extpfeil/ExtpfeilConfiguration.js";
import "@mathjax/src/mjs/input/tex/html/HtmlConfiguration.js";

const fonts = import.meta.glob("../../node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js");
(mathjax as unknown as { asyncLoad: (name: string) => Promise<unknown> }).asyncLoad = async (name: string) => {
  const suffix = `/svg/dynamic/${name.split("/").at(-1)!.replace(/\.js$/, "")}.js`;
  const entry = Object.entries(fonts).find(([path]) => path.endsWith(suffix));
  if (!entry) throw new Error(`MathJax extension not bundled: ${name}`);
  return entry[1]();
};

RegisterHTMLHandler(browserAdaptor());

const packages = ["base", "ams", "newcommand", "configmacros", "textmacros", "color", "mathtools", "mhchem",
  "noerrors", "noundefined", "boldsymbol", "cancel", "physics", "braket", "bbox", "enclose", "unicode",
  "upgreek", "gensymb", "cases", "extpfeil", "html"];

export function createMathDocument() {
  return mathjax.document(document, {
    InputJax: new TeX({ packages, tags: "none" }),
    OutputJax: new SVG({ fontCache: "none", font: new MathJaxNewcmFont() }),
  });
}
