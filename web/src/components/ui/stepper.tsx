/**
 * Stepper（shadcn/ui 风格步骤条组件）
 *
 * 基于社区 stepperize/react 封装改造适配（去除库依赖，受控状态本地实现）：
 * - 支持 horizontal / vertical 方向、responsive 断点切换、键盘导航、自定义 indicators
 * - vertical 模式可复刻 GitHub TimelineItem 时间线骨架（节点 + 竖线 + 内容）
 * - StepperIndicator 提供 plain 变体：无状态变色，专供时间线等非步骤展示使用
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
} from "react";
import { cn } from "@/lib/utils";

// Types
type StepperOrientation = "horizontal" | "vertical";
type StepState = "active" | "completed" | "inactive" | "loading";
type StepIndicators = {
  active?: ReactNode;
  completed?: ReactNode;
  inactive?: ReactNode;
  loading?: ReactNode;
};

type StepDefinition = {
  id: string;
  title?: string;
  description?: string;
  icon?: ReactNode;
};

interface StepperContextValue {
  steps: StepDefinition[];
  orientation: StepperOrientation;
  configOrientation: StepperOrientation;
  responsive?: boolean;
  currentId: string | undefined;
  goTo: (id: string) => void;
  getIndex: (id: string) => number;
  registerTrigger: (node: HTMLButtonElement | null, remove?: boolean) => void;
  triggerNodes: HTMLButtonElement[];
  focusNext: (currentIdx: number) => void;
  focusPrev: (currentIdx: number) => void;
  focusFirst: () => void;
  focusLast: () => void;
  indicators: StepIndicators;
}

interface StepItemContextValue {
  step: StepDefinition;
  index: number;
  state: StepState;
  isDisabled: boolean;
  isLoading: boolean;
}

const StepperContext = createContext<StepperContextValue | undefined>(undefined);
const StepItemContext = createContext<StepItemContextValue | undefined>(undefined);

function useStepper() {
  const ctx = useContext(StepperContext);
  if (!ctx) throw new Error("useStepper must be used within a Stepper");
  return ctx;
}

function useStepItem() {
  const ctx = useContext(StepItemContext);
  if (!ctx) throw new Error("useStepItem must be used within a StepperItem");
  return ctx;
}

interface StepperProps extends HTMLAttributes<HTMLDivElement> {
  steps: StepDefinition[];
  defaultValue?: string;
  orientation?: StepperOrientation;
  responsive?: boolean;
  indicators?: StepIndicators;
  value?: string;
  onValueChange?: (value: string) => void;
}

function Stepper({
  steps,
  defaultValue,
  orientation = "horizontal",
  responsive = false,
  className,
  children,
  indicators = {},
  value,
  onValueChange,
  ...props
}: StepperProps) {
  // 内部 current 状态；受控时以 value 为准
  const [internalId, setInternalId] = useState<string | undefined>(
    defaultValue ?? steps[0]?.id,
  );
  const currentId = typeof value === "string" ? value : internalId;

  const [triggerNodes, setTriggerNodes] = useState<HTMLButtonElement[]>([]);

  // 断点跟踪（tailwind md = 768px）：responsive 且配置 horizontal 时小屏切 vertical
  const [isMdUp, setIsMdUp] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );

  useEffect(() => {
    if (!responsive) return;
    const mql = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsMdUp("matches" in e ? e.matches : mql.matches);
    mql.addEventListener("change", handler);
    return () => {
      mql.removeEventListener("change", handler);
    };
  }, [responsive]);

  const goTo = useCallback(
    (id: string) => {
      setInternalId(id);
      onValueChange?.(id);
    },
    [onValueChange],
  );

  const getIndex = useCallback(
    (id: string) => Math.max(0, steps.findIndex((s) => s.id === id)),
    [steps],
  );

  // 注册/注销 trigger（键盘导航用）
  const registerTrigger = useCallback((node: HTMLButtonElement | null, remove = false) => {
    setTriggerNodes((prev) => {
      if (!node) return prev;
      if (remove) return prev.filter((n) => n !== node);
      return prev.includes(node) ? prev : [...prev, node];
    });
  }, []);

  const focusNext = useCallback(
    (currentIdx: number) => triggerNodes[(currentIdx + 1) % triggerNodes.length]?.focus(),
    [triggerNodes],
  );
  const focusPrev = useCallback(
    (currentIdx: number) =>
      triggerNodes[(currentIdx - 1 + triggerNodes.length) % triggerNodes.length]?.focus(),
    [triggerNodes],
  );
  const focusFirst = useCallback(() => triggerNodes[0]?.focus(), [triggerNodes]);
  const focusLast = useCallback(
    () => triggerNodes[triggerNodes.length - 1]?.focus(),
    [triggerNodes],
  );

  // responsive 时的生效方向
  const effectiveOrientation: StepperOrientation = useMemo(() => {
    if (responsive && orientation === "horizontal") {
      return isMdUp ? "horizontal" : "vertical";
    }
    return orientation;
  }, [responsive, orientation, isMdUp]);

  const contextValue = useMemo<StepperContextValue>(
    () => ({
      steps,
      orientation: effectiveOrientation,
      configOrientation: orientation,
      responsive,
      currentId,
      goTo,
      getIndex,
      registerTrigger,
      triggerNodes,
      focusNext,
      focusPrev,
      focusFirst,
      focusLast,
      indicators,
    }),
    [
      steps,
      effectiveOrientation,
      orientation,
      responsive,
      currentId,
      goTo,
      getIndex,
      registerTrigger,
      triggerNodes,
      focusNext,
      focusPrev,
      focusFirst,
      focusLast,
      indicators,
    ],
  );

  return (
    <StepperContext.Provider value={contextValue}>
      <div
        role="tablist"
        aria-orientation={effectiveOrientation}
        data-slot="stepper"
        data-orientation={effectiveOrientation}
        className={cn("w-full", className)}
        {...props}
      >
        {children}
      </div>
    </StepperContext.Provider>
  );
}

interface StepperItemProps extends HTMLAttributes<HTMLDivElement> {
  stepId: string;
  completed?: boolean;
  disabled?: boolean;
  loading?: boolean;
}

function StepperItem({
  stepId,
  completed = false,
  disabled = false,
  loading = false,
  className,
  children,
  ...props
}: StepperItemProps) {
  const { steps, orientation, currentId, getIndex } = useStepper();
  const stepIndex = getIndex(stepId);
  const currentIndex = getIndex(currentId ?? "");
  const step = steps.find((s) => s.id === stepId) ?? steps[0];

  const state: StepState =
    completed || stepIndex < currentIndex
      ? "completed"
      : currentIndex === stepIndex
        ? "active"
        : "inactive";

  const isLoading = loading && currentIndex === stepIndex;
  const isVertical = orientation === "vertical";

  return (
    <StepItemContext.Provider
      value={{ step, index: stepIndex, state, isDisabled: disabled, isLoading }}
    >
      <div
        data-slot="stepper-item"
        data-state={state}
        {...(isLoading ? { "data-loading": true } : {})}
        className={cn(
          "group/step flex items-center justify-center",
          // vertical：min-h-14 保证 step 间固有最小竖向间隔（内容高时自然扩展，连线由 StepperNav 贯穿竖线自动处理）
          isVertical ? "min-h-14 flex-col" : "not-last:flex-1",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </StepItemContext.Provider>
  );
}

interface StepperTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

function StepperTrigger({
  asChild = false,
  className,
  children,
  tabIndex,
  ...props
}: StepperTriggerProps) {
  const { step, state, isLoading } = useStepItem();
  const {
    currentId,
    goTo,
    registerTrigger,
    triggerNodes,
    focusNext,
    focusPrev,
    focusFirst,
    focusLast,
  } = useStepper();
  const isSelected = currentId === step.id;
  const id = `stepper-tab-${step.id}`;
  const panelId = `stepper-panel-${step.id}`;

  // 注册 trigger（回调 ref，正确 mount/unmount）
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      if (node) {
        btnRef.current = node;
        registerTrigger(node);
      } else if (btnRef.current) {
        registerTrigger(btnRef.current, true);
        btnRef.current = null;
      }
    },
    [registerTrigger],
  );

  const myIdx = useMemo(
    () => triggerNodes.findIndex((n) => n === btnRef.current),
    [triggerNodes],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        if (myIdx !== -1) focusNext(myIdx);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        if (myIdx !== -1) focusPrev(myIdx);
        break;
      case "Home":
        e.preventDefault();
        focusFirst();
        break;
      case "End":
        e.preventDefault();
        focusLast();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        goTo(step.id);
        break;
    }
  };

  if (asChild) {
    return (
      <span data-slot="stepper-trigger" data-state={state} className={className}>
        {children}
      </span>
    );
  }

  return (
    <button
      ref={triggerRef}
      role="tab"
      id={id}
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={typeof tabIndex === "number" ? tabIndex : isSelected ? 0 : -1}
      data-slot="stepper-trigger"
      data-state={state}
      data-loading={isLoading}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2.5 rounded-full outline-none disabled:pointer-events-none disabled:opacity-60",
        className,
      )}
      onClick={() => goTo(step.id)}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {children}
    </button>
  );
}

interface StepperIndicatorProps extends ComponentProps<"div"> {
  variant?: "default" | "outline" | "plain";
}

function StepperIndicator({ children, className, variant = "default" }: StepperIndicatorProps) {
  const { state, isLoading, step } = useStepItem();
  const { indicators } = useStepper();

  const base =
    "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md text-sm font-medium transition-all duration-300";

  const defaultClasses = cn(
    "border-background bg-muted text-muted-foreground ring-offset-background data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground group-data-[state=active]/step:ring-2 group-data-[state=active]/step:ring-primary/30 group-data-[state=active]/step:ring-offset-3",
    base,
  );

  const outlineClasses = cn(
    "border border-primary/20 bg-transparent text-muted-foreground data-[state=completed]:border-foreground data-[state=completed]:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground",
    base,
  );

  // plain：无状态变色，纯展示节点（时间线头像/图标等）
  const plainClasses = cn("border-0 bg-transparent text-muted-foreground", base);

  const classes =
    variant === "outline" ? outlineClasses : variant === "plain" ? plainClasses : defaultClasses;

  return (
    <div data-slot="stepper-indicator" data-state={state} className={cn(classes, className)}>
      <div className="absolute inset-0 flex items-center justify-center">
        {(isLoading ? indicators?.loading : indicators?.[state]) ??
          (step?.icon ? <span className="*:[svg]:size-4">{step.icon}</span> : children)}
      </div>
    </div>
  );
}

function StepperSeparator({ className }: ComponentProps<"div">) {
  const { state } = useStepItem();
  const { orientation } = useStepper();
  const isVertical = orientation === "vertical";

  return (
    <div
      data-slot="stepper-separator"
      data-state={state}
      className={cn(
        "m-2 rounded-sm bg-muted transition-colors duration-500 group-data-[state=completed]/step:bg-primary",
        isVertical ? "h-auto w-0.5 flex-1" : "h-0.5 flex-1",
        className,
      )}
    />
  );
}

function StepperTitle({ children, className }: ComponentProps<"h3">) {
  const { state } = useStepItem();
  return (
    <h3 data-slot="stepper-title" data-state={state} className={cn("text-sm font-medium", className)}>
      {children}
    </h3>
  );
}

function StepperDescription({ children, className }: ComponentProps<"div">) {
  const { state } = useStepItem();
  return (
    <div
      data-slot="stepper-description"
      data-state={state}
      className={cn("text-muted-foreground text-xs font-medium", className)}
    >
      {children}
    </div>
  );
}

function StepperNav({ children, className }: ComponentProps<"nav">) {
  const { currentId, orientation, configOrientation, responsive } = useStepper();
  const isVertical = orientation === "vertical";
  const responsiveNavClasses =
    responsive && configOrientation === "horizontal" ? "flex-col md:flex-row md:w-full" : "";

  return (
    <nav
      data-slot="stepper-nav"
      data-state={currentId}
      data-orientation={orientation}
      className={cn(
        "inline-flex",
        isVertical ? "relative flex-col" : "w-full flex-row",
        responsiveNavClasses,
        className,
      )}
    >
      {/* vertical 自动连线：一条贯穿 nav 的竖线（left-4 = 默认 indicator 中心 16px），
          节点圆形背景盖线 → step 间自动无缝连线，无需手动 StepperSeparator；
          自定义 indicator 偏移时用 className 覆盖 left（如 left-3） */}
      {isVertical && (
        <div
          aria-hidden
          data-slot="stepper-line"
          className="pointer-events-none absolute inset-y-0 left-4 w-px bg-border"
        />
      )}
      {children}
    </nav>
  );
}

function StepperPanel({ children, className }: ComponentProps<"div">) {
  const { currentId } = useStepper();
  return (
    <div data-slot="stepper-panel" data-state={currentId} className={cn("w-full", className)}>
      {children}
    </div>
  );
}

interface StepperContentProps extends ComponentProps<"div"> {
  value: string;
  forceMount?: boolean;
}

function StepperContent({ value, forceMount, children, className }: StepperContentProps) {
  const { currentId } = useStepper();
  const isActive = value === currentId;

  if (!forceMount && !isActive) {
    return null;
  }

  return (
    <div
      role="tabpanel"
      id={`stepper-panel-${value}`}
      aria-labelledby={`stepper-tab-${value}`}
      data-slot="stepper-content"
      data-state={currentId}
      className={cn("w-full", className, !isActive && forceMount && "hidden")}
      hidden={!isActive && forceMount}
    >
      {children}
    </div>
  );
}

export {
  useStepper,
  useStepItem,
  Stepper,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperSeparator,
  StepperTitle,
  StepperDescription,
  StepperPanel,
  StepperContent,
  StepperNav,
  type StepperProps,
  type StepperItemProps,
  type StepperTriggerProps,
  type StepperContentProps,
};
