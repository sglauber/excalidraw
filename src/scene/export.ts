import rough from "roughjs/bin/rough";
import { NonDeletedExcalidrawElement, Theme } from "../element/types";
import { getCommonBounds } from "../element/bounds";
import { renderScene, renderSceneToSvg } from "../renderer/renderScene";
import { distance } from "../utils";
import { AppState, BinaryFiles } from "../types";
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_EXPORT_PADDING,
  DEFAULT_ZOOM_VALUE,
  ENV,
  SVG_NS,
  THEME,
  THEME_FILTER,
} from "../constants";
import { serializeAsJSON } from "../data/json";
import {
  getInitializedImageElements,
  updateImageCache,
} from "../element/image";
import { restoreAppState } from "../data/restore";

export const SVG_EXPORT_TAG = `<!-- svg-source:excalidraw -->`;

export type ExportToCanvasData = {
  elements: readonly NonDeletedExcalidrawElement[];
  appState?: Partial<Omit<AppState, "offsetTop" | "offsetLeft">>;
  files: BinaryFiles | null;
};

export type ExportToCanvasConfig = {
  theme?: Theme;
  /**
   * Canvas background. Valid values are:
   *
   * - `undefined` - the background of "appState.viewBackgroundColor" is used.
   * - `false` - no background is used (set to "transparent").
   * - `string` - should be a valid CSS color.
   *
   * @default undefined
   */
  canvasBackgroundColor?: string | false;
  /**
   * Canvas padding in pixels. Affected by scale. Ignored if `fit` is set to
   * `cover`.
   *
   * @default 10
   */
  padding?: number;
  // -------------------------------------------------------------------------
  /**
   * Makes sure the canvas content fits into a frame of width/height no larger
   * than this value, while maintaining the aspect ratio.
   *
   * Final dimensions can get smaller/larger if used in conjunction with
   * `scale`.
   */
  maxWidthOrHeight?: number;
  /**
   * Scale the canvas content to be excatly this many pixels wide/tall.
   *
   * Cannot be used in conjunction with `maxWidthOrHeight`.
   *
   * Final dimensions can get smaller/larger if used in conjunction with
   * `scale`.
   */
  widthOrHeight?: number;
  // -------------------------------------------------------------------------
  /**
   * Width of the frame. Supply `x` or `y` if you want to ofsset the canvas
   * content.
   *
   * If `width` omitted but `height` supplied, `width` is calculated from the
   * the content's bounding box to preserve the aspect ratio.
   *
   * Defaults to the content bounding box width when both `width` and `height`
   * are omitted.
   */
  width?: number;
  /**
   * Height of the frame.
   *
   * If `height` omitted but `width` supplied, `height` is calculated from the
   * content's bounding box to preserve the aspect ratio.
   *
   * Defaults to the content bounding box height when both `width` and `height`
   * are omitted.
   */
  height?: number;
  /**
   * Left canvas offset. By default the coordinate is relative to the canvas.
   * You can switch to content coordinates by setting `origin` to `content`.
   *
   * Defaults to the `x` postion of the content bounding box.
   */
  x?: number;
  /**
   * Top canvas offset. By default the coordinate is relative to the canvas.
   * You can switch to content coordinates by setting `origin` to `content`.
   *
   * Defaults to the `y` postion of the content bounding box.
   */
  y?: number;
  /**
   * Indicates the coordinate system of the `x` and `y` values.
   *
   * - `canvas` - `x` and `y` are relative to the canvas [0, 0] position.
   * - `content` - `x` and `y` are relative to the content bounding box.
   *
   * @default "canvas"
   */
  origin?: "canvas" | "content";
  /**
   * If dimensions specified and `x` and `y` are not specified, this indicates
   * how the canvas should be scaled.
   *
   * Behavior aligns with the `object-fit` CSS property.
   *
   * - `none`    - no scaling.
   * - `contain` - scale to fit the frame.
   * - `cover`   - scale to fill the frame while maintaining aspect ratio. If
   *               content overflows, it will be cropped.
   *
   * @default "contain" unless `x` or `y` are specified, in which case "none"
   * is used (forced).
   */
  fit?: "none" | "contain" | "cover";
  /**
   * When either `x` or `y` are not specified, indicates how the canvas should
   * be aligned on the respective axis.
   *
   * - `none`   - canvas aligned to top left.
   * - `center` - canvas is centered on the axis which is not specified
   *              (or both).
   *
   * @default "center"
   */
  position?: "center" | "none";
  // -------------------------------------------------------------------------
  /**
   * A multiplier to increase/decrease the frame dimensions
   * (content resolution).
   *
   * For example, if your canvas is 300x150 and you set scale to 2, the
   * resulting size will be 600x300.
   *
   * @default 1
   */
  scale?: number;
  /**
   * If you need to suply your own canvas, e.g. in test environments or in
   * Node.js.
   *
   * Do not set `canvas.width/height` or modify the canvas context as that's
   * handled by Excalidraw.
   *
   * Defaults to `document.createElement("canvas")`.
   */
  createCanvas?: () => HTMLCanvasElement;
  /**
   * If you want to supply `width`/`height` dynamically (or derive from the
   * content bounding box), you can use this function.
   *
   * Ignored if `maxWidthOrHeight`, `width`, or `height` is set.
   */
  getDimensions?: (
    width: number,
    height: number,
  ) => { width: number; height: number; scale?: number };
};

/**
 * This API is usually used as a precursor to searializing to Blob or PNG,
 * but can also be used to create a canvas for other purposes.
 */
export const exportToCanvas = async ({
  data,
  config,
}: {
  data: ExportToCanvasData;
  config?: ExportToCanvasConfig;
}) => {
  // initialize defaults
  // ---------------------------------------------------------------------------
  const { elements, files } = data;

  const appState = restoreAppState(data.appState, null);

  // clone
  const cfg = Object.assign({}, config);

  if (cfg.x != null || cfg.x != null) {
    if (cfg.fit != null && cfg.fit !== "none") {
      if (process.env.NODE_ENV !== ENV.PRODUCTION) {
        console.warn(
          "`fit` will be ignored (automatically set to `none`) when you specify `x` or `y` offsets",
        );
      }
    }
    cfg.fit = "none";
  }

  cfg.fit = cfg.fit ?? "contain";

  if (cfg.fit === "cover" && cfg.padding) {
    if (process.env.NODE_ENV !== ENV.PRODUCTION) {
      console.warn("`padding` is ignored when `fit` is set to `cover`");
    }
    cfg.padding = 0;
  }

  cfg.scale = cfg.scale ?? 1;

  cfg.origin = cfg.origin ?? "canvas";
  cfg.position = cfg.position ?? "center";
  cfg.padding = cfg.padding ?? DEFAULT_EXPORT_PADDING;

  if (cfg.maxWidthOrHeight != null && cfg.widthOrHeight != null) {
    if (process.env.NODE_ENV !== ENV.PRODUCTION) {
      console.warn("`maxWidthOrHeight` is ignored when `widthOrHeight` is set");
    }
    cfg.maxWidthOrHeight = undefined;
  }

  if (
    (cfg.maxWidthOrHeight != null || cfg.width != null || cfg.height != null) &&
    cfg.getDimensions
  ) {
    if (process.env.NODE_ENV !== ENV.PRODUCTION) {
      console.warn(
        "`getDimensions` is ignored when `width`, `height`, or `maxWidthOrHeight` is set",
      );
    }
    cfg.getDimensions = undefined;
  }
  // ---------------------------------------------------------------------------

  // value used to scale the canvas context. By default, we use this to
  // make the canvas fit into the frame (e.g. for `cfg.fit` set to `contain`).
  // If `cfg.scale` is set, we multiply the resulting canvasScale by it to
  // scale the output further.
  let canvasScale = 1;

  const origCanvasSize = getCanvasSize(elements, cfg.padding);

  // variables for original content bounding box
  const [origX, origY, origWidth, origHeight] = origCanvasSize;
  // variables for target bounding box
  let [x, y, width, height] = origCanvasSize;

  if (cfg.maxWidthOrHeight != null || cfg.widthOrHeight != null) {
    const max = Math.max(origWidth, origHeight);
    if (cfg.widthOrHeight != null) {
      // calculate by how much do we need to scale the canvas to fit into the
      // target dimension (e.g. target: max 50px, actual: 70x100px => scale: 0.5)
      canvasScale = cfg.widthOrHeight / max;
    } else if (cfg.maxWidthOrHeight != null) {
      canvasScale = cfg.maxWidthOrHeight < max ? cfg.maxWidthOrHeight / max : 1;
    }

    width *= canvasScale;
    height *= canvasScale;
  } else if (cfg.width != null) {
    width = cfg.width;

    if (cfg.height) {
      height = cfg.height;
    } else {
      // if height not specified, scale the original height to match the new
      // width while maintaining aspect ratio
      height *= width / origWidth;
    }
  } else if (cfg.height != null) {
    height = cfg.height;
    // width not specified, so scale the original width to match the new
    // height while maintaining aspect ratio
    width *= height / origHeight;
  } else if (cfg.getDimensions) {
    const ret = cfg.getDimensions(width, height);

    width = ret.width;
    height = ret.height;
    cfg.scale = ret.scale ?? cfg.scale;
  }

  if (cfg.fit === "contain" && !cfg.maxWidthOrHeight) {
    const wRatio = width / origWidth;
    const hRatio = height / origHeight;
    // scale the orig canvas to fit in the target frame
    canvasScale = Math.min(wRatio, hRatio);
  } else if (cfg.fit === "cover") {
    const wRatio = width / origWidth;
    const hRatio = height / origHeight;
    // scale the orig canvas to fill the the target frame
    // (opposite of "contain")
    canvasScale = Math.max(wRatio, hRatio);
  }

  x = cfg.x ?? origX;
  y = cfg.y ?? origY;

  // if we switch to "content" coords, we need to offset cfg-supplied
  // coords by the x/y of content bounding box
  if (cfg.origin === "content") {
    if (cfg.x != null) {
      x += origX;
    }
    if (cfg.y != null) {
      y += origY;
    }
  }

  // Centering the content to the frame.
  // We divide width/height by canvasScale so that we calculate in the original
  // aspect ratio dimensions.
  if (cfg.position === "center") {
    if (cfg.x == null) {
      x -= width / canvasScale / 2 - origWidth / 2;
    }
    if (cfg.y == null) {
      y -= height / canvasScale / 2 - origHeight / 2;
    }
  }

  const canvas = cfg.createCanvas
    ? cfg.createCanvas()
    : document.createElement("canvas");

  // scale the whole frame by cfg.scale (on top of whatever canvasScale we
  // calculated above)
  canvasScale *= cfg.scale;
  width *= cfg.scale;
  height *= cfg.scale;

  canvas.width = width;
  canvas.height = height;

  const { imageCache } = await updateImageCache({
    imageCache: new Map(),
    fileIds: getInitializedImageElements(elements).map(
      (element) => element.fileId,
    ),
    files: files || {},
  });

  renderScene({
    elements,
    appState: { ...appState, width, height, offsetLeft: 0, offsetTop: 0 },
    rc: rough.canvas(canvas),
    canvas,
    renderConfig: {
      canvasBackgroundColor:
        cfg.canvasBackgroundColor === false
          ? // null indicates transparent background
            null
          : cfg.canvasBackgroundColor ||
            appState.viewBackgroundColor ||
            DEFAULT_BACKGROUND_COLOR,
      scrollX: -x + cfg.padding,
      scrollY: -y + cfg.padding,
      canvasScale,
      zoom: { value: DEFAULT_ZOOM_VALUE },
      remotePointerViewportCoords: {},
      remoteSelectedElementIds: {},
      shouldCacheIgnoreZoom: false,
      remotePointerUsernames: {},
      remotePointerUserStates: {},
      theme: cfg.theme || THEME.LIGHT,
      imageCache,
      renderScrollbars: false,
      renderSelection: false,
      renderGrid: false,
      isExporting: true,
    },
  });

  return canvas;
};

export const exportToSvg = async (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: {
    exportBackground: boolean;
    exportPadding?: number;
    exportScale?: number;
    viewBackgroundColor: string;
    exportWithDarkMode?: boolean;
    exportEmbedScene?: boolean;
  },
  files: BinaryFiles | null,
  opts?: {
    serializeAsJSON?: () => string;
  },
): Promise<SVGSVGElement> => {
  const {
    exportPadding = DEFAULT_EXPORT_PADDING,
    viewBackgroundColor,
    exportScale = 1,
    exportEmbedScene,
  } = appState;
  let metadata = "";
  if (exportEmbedScene) {
    try {
      metadata = await (
        await import(/* webpackChunkName: "image" */ "../../src/data/image")
      ).encodeSvgMetadata({
        text: opts?.serializeAsJSON
          ? opts?.serializeAsJSON?.()
          : serializeAsJSON(elements, appState, files || {}, "local"),
      });
    } catch (error: any) {
      console.error(error);
    }
  }
  const [minX, minY, width, height] = getCanvasSize(elements, exportPadding);

  // initialize SVG root
  const svgRoot = document.createElementNS(SVG_NS, "svg");
  svgRoot.setAttribute("version", "1.1");
  svgRoot.setAttribute("xmlns", SVG_NS);
  svgRoot.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svgRoot.setAttribute("width", `${width * exportScale}`);
  svgRoot.setAttribute("height", `${height * exportScale}`);
  if (appState.exportWithDarkMode) {
    svgRoot.setAttribute("filter", THEME_FILTER);
  }

  let assetPath = "https://excalidraw.com/";

  // Asset path needs to be determined only when using package
  if (process.env.IS_EXCALIDRAW_NPM_PACKAGE) {
    assetPath =
      window.EXCALIDRAW_ASSET_PATH ||
      `https://unpkg.com/${process.env.PKG_NAME}@${process.env.PKG_VERSION}`;

    if (assetPath?.startsWith("/")) {
      assetPath = assetPath.replace("/", `${window.location.origin}/`);
    }
    assetPath = `${assetPath}/dist/excalidraw-assets/`;
  }
  svgRoot.innerHTML = `
  ${SVG_EXPORT_TAG}
  ${metadata}
  <defs>
    <style class="style-fonts">
      @font-face {
        font-family: "Virgil";
        src: url("${assetPath}Virgil.woff2");
      }
      @font-face {
        font-family: "Cascadia";
        src: url("${assetPath}Cascadia.woff2");
      }
    </style>
  </defs>
  `;
  // render background rect
  if (appState.exportBackground && viewBackgroundColor) {
    const rect = svgRoot.ownerDocument!.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", `${width}`);
    rect.setAttribute("height", `${height}`);
    rect.setAttribute("fill", viewBackgroundColor);
    svgRoot.appendChild(rect);
  }

  const rsvg = rough.svg(svgRoot);
  renderSceneToSvg(elements, rsvg, svgRoot, files || {}, {
    offsetX: -minX + exportPadding,
    offsetY: -minY + exportPadding,
    exportWithDarkMode: appState.exportWithDarkMode,
  });

  return svgRoot;
};

// calculate smallest area to fit the contents in
const getCanvasSize = (
  elements: readonly NonDeletedExcalidrawElement[],
  exportPadding: number,
): [minX: number, minY: number, width: number, height: number] => {
  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  const width = distance(minX, maxX) + exportPadding * 2;
  const height = distance(minY, maxY) + exportPadding + exportPadding;

  return [minX, minY, width, height];
};

export const getExportSize = (
  elements: readonly NonDeletedExcalidrawElement[],
  padding: number,
  scale: number,
): [number, number] => {
  const [, , width, height] = getCanvasSize(elements, padding).map(
    (dimension) => Math.trunc(dimension * scale),
  );

  return [width, height];
};
