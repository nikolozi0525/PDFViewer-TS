import { Vec2 } from "mathador";
import { Quadruple } from "ts-viewers-core";

import { RenderableAnnotation, AnnotationRenderResult } from "../common/annotation";
import { PageInfo } from "../common/page";
import { applyFlipYToElement } from "../drawing/transformations";

import { DocumentService, annotChangeEvent, 
  AnnotEvent, AnnotSelectionRequestEvent, AnnotFocusRequestEvent } 
  from "../services/document-service";
  
import { AnnotationDict } from "../document/entities/annotations/annotation-dict";

export class PageAnnotationView {
  private readonly _docService: DocumentService;
  private readonly _pageInfo: PageInfo;
  private readonly _viewbox: Quadruple;
  private readonly _rendered = new Set<RenderableAnnotation>();

  private _container: HTMLDivElement;
  private _svg: SVGSVGElement;

  private _destroyed: boolean;

  constructor(docService: DocumentService, pageInfo: PageInfo, pageDimensions: Vec2) {
    if (!docService || !pageInfo || !pageDimensions) {
      throw new Error("Required argument not found");
    }
    this._pageInfo = pageInfo;
    this._viewbox = [0, 0, pageDimensions.x, pageDimensions.y];

    this._docService = docService;

    this._container = document.createElement("div");
    this._container.classList.add("page-annotations");

    this._svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this._svg.classList.add("page-annotations-controls");
    this._svg.setAttribute("data-page-id", pageInfo.id + "");
    this._svg.setAttribute("viewBox", `0 0 ${pageDimensions.x} ${pageDimensions.y}`);
    applyFlipYToElement(this._svg);

    // handle annotation selection
    this._svg.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.target === this._svg) {
        docService.setSelectedAnnotation(null);
      }
    });    
  } 

  /**free the resources that can prevent garbage to be collected */
  destroy() {
    this._destroyed = true;

    this.remove();
    this._container = null;

    this._rendered.forEach(x => {
      x.$onPointerDownAction = null;
      x.$onPointerEnterAction = null;
      x.$onPointerLeaveAction = null;
    });
    this._rendered.clear();
  }

  /**remove the container from DOM */
  remove() {    
    this._container?.remove();
    this._docService.eventService.removeListener(annotChangeEvent, this.onAnnotationSelectionChange);
  }  

  /**
   * render the page annotations and append them to the specified parent container
   * @param parent 
   * @returns 
   */
  async appendAsync(parent: HTMLElement) {
    if (this._destroyed) {
      return;
    }
    
    parent.append(this._container);
    
    const renderResult = await this.renderAnnotationsAsync();
    if (!renderResult) {
      this._container?.remove();
      return;
    }

    this._docService.eventService.addListener(annotChangeEvent, this.onAnnotationSelectionChange);
  }

  private async renderAnnotationsAsync(): Promise<boolean> { 
    if (this._destroyed) {
      return false;
    }
    
    this.clear();

    const annotations = (await this._docService
      .getPageAnnotationsAsync(this._pageInfo.id))
      .filter(x => !x.deleted)
      || [];

    const processAnnotation = async (annotation: AnnotationDict) => {
      let renderResult: AnnotationRenderResult;
      if (!this._rendered.has(annotation)) {
        // attach events to the annotation
        annotation.$onPointerDownAction = (e: PointerEvent) => {
          this._docService.eventService.dispatchEvent(new AnnotSelectionRequestEvent({annotation}));
        };        
        annotation.$onPointerEnterAction = (e: PointerEvent) => {
          this._docService.eventService.dispatchEvent(new AnnotFocusRequestEvent({annotation}));
        };        
        annotation.$onPointerLeaveAction = (e: PointerEvent) => {
          this._docService.eventService.dispatchEvent(new AnnotFocusRequestEvent({annotation: null}));
        };
        renderResult = await annotation.renderAsync(this._pageInfo);
      } else {
        renderResult = annotation.lastRenderResult || await annotation.renderAsync(this._pageInfo);
      }   

      if (renderResult && !this._destroyed) {
        this._rendered.add(annotation);
        this._svg.append(renderResult.controls);
        this._container.append(renderResult.content);
      }
    }; 

    await Promise.all(annotations.map(x => processAnnotation(x)));

    if (this._destroyed) {
      return false;
    }
    
    this._container.append(this._svg);
    return true;
  }

  private clear() {
    this._container.innerHTML = "";
    this._svg.innerHTML = "";
  }

  private onAnnotationSelectionChange = (e: AnnotEvent) => {
    if (!this._destroyed && e.detail.type === "select") {
      // toggle "touchAction" to prevent default gestures from interfering with the annotation edit logic
      if (e.detail.annotations?.length) {
        this._container.style.touchAction = "none";
      } else {
        this._container.style.touchAction = "";
      }
    }
  };
}
