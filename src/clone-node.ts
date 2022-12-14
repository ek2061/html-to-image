import { clonePseudoElements } from "./clone-pseudos";
import { resourceToDataURL } from "./dataurl";
import { getMimeType } from "./mimes";
import type { Options } from "./types";
import { createImage, toArray } from "./util";

async function cloneCanvasElement(canvas: HTMLCanvasElement) {
  const dataURL = canvas.toDataURL();
  if (dataURL === "data:,") {
    return canvas.cloneNode(false) as HTMLCanvasElement;
  }

  return createImage(dataURL);
}

async function cloneVideoElement(video: HTMLVideoElement, options: Options) {
  const poster = video.poster;
  const contentType = getMimeType(poster);
  const dataURL = await resourceToDataURL(poster, contentType, options);
  return createImage(dataURL);
}

async function cloneSingleNode<T extends HTMLElement>(
  node: T,
  options: Options
): Promise<HTMLElement> {
  if (node instanceof HTMLCanvasElement) {
    return cloneCanvasElement(node);
  }

  if (node instanceof HTMLVideoElement && node.poster) {
    return cloneVideoElement(node, options);
  }

  return node.cloneNode(false) as T;
}

const isSlotElement = (node: HTMLElement): node is HTMLSlotElement =>
  node.tagName != null && node.tagName.toUpperCase() === "SLOT";

async function cloneChildren<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options
): Promise<T> {
  const children =
    isSlotElement(nativeNode) && nativeNode.assignedNodes
      ? toArray<T>(nativeNode.assignedNodes())
      : toArray<T>((nativeNode.shadowRoot ?? nativeNode).childNodes);

  if (children.length === 0 || nativeNode instanceof HTMLVideoElement) {
    return clonedNode;
  }

  await children.reduce(
    (deferred, child) =>
      deferred
        .then(() => cloneNode(child, options))
        .then((clonedChild: HTMLElement | null) => {
          if (clonedChild) {
            clonedNode.appendChild(clonedChild);
          }
        }),
    Promise.resolve()
  );

  return clonedNode;
}

function cloneCSSStyle<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  const targetStyle = clonedNode.style;
  if (!targetStyle) {
    return;
  }

  const sourceStyle = window.getComputedStyle(nativeNode);
  const parent = nativeNode.parentElement;

  if (sourceStyle.cssText) {
    targetStyle.cssText = sourceStyle.cssText;
    targetStyle.transformOrigin = sourceStyle.transformOrigin;
  } else {
    toArray<string>(sourceStyle).forEach((name) => {
      let value = sourceStyle.getPropertyValue(name);
      if (name === "font-size" && value.endsWith("px")) {
        const reducedFont =
          Math.floor(parseFloat(value.substring(0, value.length - 2))) - 0.1;
        value = `${reducedFont}px`;
      }

      // non-body scrolling
      if (
        nativeNode.scrollTop > 0 &&
        (sourceStyle.overflowY === "auto" ||
          sourceStyle.overflowY === "scroll") &&
        name === "overflow-y"
      ) {
        value = "hidden";
      }

      if (parent !== null) {
        const parentStyle = window.getComputedStyle(parent);
        if (
          parent.scrollTop > 0 &&
          (parentStyle.overflowY === "auto" ||
            parentStyle.overflowY === "scroll")
        ) {
          if (name === "position") {
            value = "relative";
          } else if (name === "top") {
            value = "-" + parent.scrollTop.toString() + "px";
            // inset-block must be removed
            targetStyle.removeProperty("inset-block");
          }
        }

        // body scrolling
        if (
          sourceStyle.position !== "fixed" &&
          parentStyle.minHeight === `${window.innerHeight}px` &&
          parseInt(parentStyle.minHeight.replace("px", "")) <
            parseInt(sourceStyle.height.replace("px", ""))
        ) {
          if (name === "position") {
            value = "relative";
          } else if (name === "top") {
            value = "-" + window.scrollY.toString() + "px";
            // inset-block must be removed
            targetStyle.removeProperty("inset-block");
          }
        }
      }

      targetStyle.setProperty(
        name,
        value,
        sourceStyle.getPropertyPriority(name)
      );
    });
  }
}

function cloneInputValue<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  if (nativeNode instanceof HTMLTextAreaElement) {
    clonedNode.innerHTML = nativeNode.value;
  }

  if (nativeNode instanceof HTMLInputElement) {
    clonedNode.setAttribute("value", nativeNode.value);
  }
}

function cloneSelectValue<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  if (nativeNode instanceof HTMLSelectElement) {
    const clonedSelect = clonedNode as any as HTMLSelectElement;
    const selectedOption = Array.from(clonedSelect.children).find(
      (child) => nativeNode.value === child.getAttribute("value")
    );

    if (selectedOption) {
      selectedOption.setAttribute("selected", "");
    }
  }
}

function decorate<T extends HTMLElement>(nativeNode: T, clonedNode: T): T {
  if (clonedNode instanceof Element) {
    cloneCSSStyle(nativeNode, clonedNode);
    clonePseudoElements(nativeNode, clonedNode);
    cloneInputValue(nativeNode, clonedNode);
    cloneSelectValue(nativeNode, clonedNode);
  }

  return clonedNode;
}

export async function cloneNode<T extends HTMLElement>(
  node: T,
  options: Options,
  isRoot?: boolean
): Promise<T | null> {
  if (!isRoot && options.filter && !options.filter(node)) {
    return null;
  }

  return Promise.resolve(node)
    .then((clonedNode) => cloneSingleNode(clonedNode, options) as Promise<T>)
    .then((clonedNode) => cloneChildren(node, clonedNode, options))
    .then((clonedNode) => decorate(node, clonedNode));
}
