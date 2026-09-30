#!/usr/bin/env node
/**
 * @termix/plugin-sdk/ui is public API, implemented by
 * src/ui/plugin-host/sdk-ui.ts. Adding to it is a contract change and
 * removing from it is a breaking one, so neither should happen by accident.
 *
 * Resolves every name the module exports (through its `export *` lines too)
 * and fails when that differs from ALLOWED. A new export goes on the list in
 * the same change, which is what makes it a deliberate one. Only generic
 * shell pieces belong here: anything one feature needs lives in its plugin.
 *
 * --list prints what the module exports now.
 */

const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SDK_UI = path.join(ROOT, "src", "ui", "plugin-host", "sdk-ui.ts");
const TSCONFIG = path.join(ROOT, "tsconfig.app.json");

const ALLOWED = [
  "ActionSlot",
  "Alert",
  "AlertDescription",
  "AlertDialog",
  "AlertDialogAction",
  "AlertDialogCancel",
  "AlertDialogContent",
  "AlertDialogDescription",
  "AlertDialogFooter",
  "AlertDialogHeader",
  "AlertDialogOverlay",
  "AlertDialogPortal",
  "AlertDialogTitle",
  "AlertDialogTrigger",
  "AlertTitle",
  "Badge",
  "BarSeries",
  "BarSeriesItem",
  "BarSeriesProps",
  "BrowserSignInDialog",
  "Button",
  "ButtonProps",
  "Card",
  "CardAction",
  "CardContent",
  "CardDescription",
  "CardFooter",
  "CardGridCanvas",
  "CardHeader",
  "CardTitle",
  "Checkbox",
  "ColumnCountStepper",
  "ComponentSlot",
  "ConnectionLogPanel",
  "ConnectionLogProvider",
  "ConnectionOrigin",
  "ConnectionScreen",
  "ConnectionStage",
  "ConnectionStatus",
  "CustomKeybinding",
  "Dialog",
  "DialogClose",
  "DialogContent",
  "DialogDescription",
  "DialogFooter",
  "DialogHeader",
  "DialogOverlay",
  "DialogPortal",
  "DialogTitle",
  "DialogTrigger",
  "DropdownMenu",
  "DropdownMenuCheckboxItem",
  "DropdownMenuContent",
  "DropdownMenuGroup",
  "DropdownMenuItem",
  "DropdownMenuLabel",
  "DropdownMenuPortal",
  "DropdownMenuRadioGroup",
  "DropdownMenuRadioItem",
  "DropdownMenuSeparator",
  "DropdownMenuShortcut",
  "DropdownMenuSub",
  "DropdownMenuSubContent",
  "DropdownMenuSubTrigger",
  "DropdownMenuTrigger",
  "EmptyState",
  "FOLDER_COLORS",
  "FakeSwitch",
  "FullScreenAppPhase",
  "FullScreenAppWrapper",
  "GridCardCatalogEntry",
  "GridColSpan",
  "GridLayout",
  "GridSlot",
  "HostDefaultBadge",
  "HostDefaultField",
  "HostFeatureFields",
  "HostFeatureFieldsProps",
  "HostKeyVerificationDialog",
  "Input",
  "Kbd",
  "KbdKey",
  "KbdSeparator",
  "KeyCombo",
  "KeybindingAction",
  "KeybindingActionType",
  "Label",
  "LineChart",
  "LineChartSeries",
  "LogContext",
  "LogEntry",
  "MFAPromptMode",
  "ManagerCardError",
  "ManagerCardShell",
  "ManagerSearch",
  "MetricCard",
  "MiniStat",
  "PassphraseDialog",
  "PasswordInput",
  "PluginComponent",
  "PluginViewPlaceholder",
  "Popover",
  "PopoverAnchor",
  "PopoverContent",
  "PopoverTrigger",
  "RadialGauge",
  "RadialGaugeProps",
  "RecentActivityItem",
  "RobustClipboardProvider",
  "SSHAuthDialog",
  "ScrollArea",
  "ScrollBar",
  "SectionCard",
  "Select",
  "Select2",
  "SelectContent",
  "SelectGroup",
  "SelectItem",
  "SelectLabel",
  "SelectScrollDownButton",
  "SelectScrollUpButton",
  "SelectSeparator",
  "SelectTrigger",
  "SelectValue",
  "Separator",
  "SettingRow",
  "Sheet",
  "SheetClose",
  "SheetContent",
  "SheetDescription",
  "SheetFooter",
  "SheetHeader",
  "SheetTitle",
  "SheetTrigger",
  "Skeleton",
  "Slider",
  "Sparkline",
  "SparklineProps",
  "StatRow",
  "Switch",
  "TOTPDialog",
  "Textarea",
  "TextareaProps",
  "Tooltip",
  "TooltipContent",
  "TooltipProvider",
  "TooltipTrigger",
  "UptimeInfo",
  "VersionInfo",
  "WebSocketConnectionTarget",
  "WidgetTitle",
  "buildOriginWsUrl",
  "cn",
  "copyToClipboard",
  "createFrontendLogger",
  "createQuickConnectHost",
  "findMatchingKeybinding",
  "getAdaptiveResourceBudget",
  "getBasePath",
  "getDatabaseHealth",
  "getDeviceId",
  "getPollingEnvironmentMultiplier",
  "getRecentActivity",
  "getUptime",
  "getVersionInfo",
  "globalShortcutHandler",
  "hydrateLocalSharedHostAuth",
  "isElectron",
  "isMacPlatform",
  "isTabJumpHotkey",
  "linkedServerUrl",
  "markAdaptiveResourceUsed",
  "pluginWsUrl",
  "readFromClipboard",
  "resolveConnectionOrigin",
  "resolveRemoteHostId",
  "runAdaptiveBackgroundTask",
  "runAdaptivePolling",
  "runVisibleInterval",
  "useAdaptivePolling",
  "useAppTheme",
  "useConfirmation",
  "useConnectionLog",
  "useIsDefaultsEditor",
  "useIsMobile",
  "useOptionalConnectionLog",
  "useTabs",
  "useTabsSafe",
];

/** Every name a module exports, resolved the way the compiler sees it. */
function exportedNames(file = SDK_UI, tsconfig = TSCONFIG) {
  const ts = require("typescript");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfig,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  const program = ts.createProgram([file], {
    ...(parsed?.options ?? {}),
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const symbol = source && checker.getSymbolAtLocation(source);
  if (!symbol) throw new Error(`Cannot read the exports of ${file}`);
  return checker
    .getExportsOfModule(symbol)
    .map((entry) => entry.getName())
    .sort();
}

const SNAPSHOT = path.join(ROOT, "packages", "plugin-sdk", "ui.api.txt");

/**
 * One line per export with its type as the compiler prints it. Committed as
 * packages/plugin-sdk/ui.api.txt, so a changed prop or signature shows up as
 * a diff instead of reaching plugins unnoticed.
 */
function exportSignatures(file = SDK_UI, tsconfig = TSCONFIG) {
  const ts = require("typescript");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfig,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  const program = ts.createProgram([file], {
    ...(parsed?.options ?? {}),
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const symbol = source && checker.getSymbolAtLocation(source);
  const flags =
    ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.WriteArrowStyleSignature;
  return checker
    .getExportsOfModule(symbol)
    .map((entry) => {
      const target =
        entry.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(entry)
          : entry;
      const isValue = !!(target.flags & ts.SymbolFlags.Value);
      const declaration = target.declarations?.[0] ?? source;
      const type = isValue
        ? checker.getTypeOfSymbolAtLocation(target, declaration)
        : checker.getDeclaredTypeOfSymbol(target);
      const text = checker
        .typeToString(type, undefined, flags)
        .replace(/import\("[^"]*"\)\./g, "")
        .replace(/\s+/g, " ");
      return `${entry.getName()} (${isValue ? "value" : "type"}): ${text}`;
    })
    .sort()
    .join("\n")
    .concat("\n");
}

/** What the module adds to, and drops from, the allowlist. */
function compare(names, allowed = ALLOWED) {
  const allowedSet = new Set(allowed);
  const nameSet = new Set(names);
  return {
    added: names.filter((name) => !allowedSet.has(name)),
    removed: allowed.filter((name) => !nameSet.has(name)),
  };
}

function main() {
  const fs = require("node:fs");
  if (/^export (type )?\*/m.test(fs.readFileSync(SDK_UI, "utf8"))) {
    console.error(
      "sdk-ui.ts uses export *; name each export so nothing becomes public API by accident.",
    );
    process.exit(1);
  }
  if (process.argv.includes("--update-snapshot")) {
    fs.writeFileSync(SNAPSHOT, exportSignatures());
    console.log(`Wrote ${path.relative(ROOT, SNAPSHOT)}`);
    return;
  }
  const saved = fs.existsSync(SNAPSHOT)
    ? fs.readFileSync(SNAPSHOT, "utf8")
    : "";
  const current = exportSignatures();
  if (current !== saved) {
    const before = new Set(saved.split("\n"));
    const after = new Set(current.split("\n"));
    console.error(
      "@termix/plugin-sdk/ui changed shape. If that is deliberate, run: node scripts/check-sdk-ui-exports.cjs --update-snapshot",
    );
    for (const line of saved.split("\n")) {
      if (line && !after.has(line)) console.error(`  - ${line.slice(0, 200)}`);
    }
    for (const line of current.split("\n")) {
      if (line && !before.has(line)) console.error(`  + ${line.slice(0, 200)}`);
    }
    process.exitCode = 1;
  }
  const names = exportedNames();
  if (process.argv.includes("--list")) {
    console.log(names.join("\n"));
    return;
  }
  const { added, removed } = compare(names);
  if (added.length === 0 && removed.length === 0) return;
  if (added.length > 0) {
    console.error(
      "@termix/plugin-sdk/ui exports names that are not on the allowlist in scripts/check-sdk-ui-exports.cjs:",
    );
    for (const name of added) console.error(`  + ${name}`);
  }
  if (removed.length > 0) {
    console.error(
      "@termix/plugin-sdk/ui no longer exports these allowlisted names (a breaking change for plugins):",
    );
    for (const name of removed) console.error(`  - ${name}`);
  }
  process.exit(1);
}

if (require.main === module) main();

module.exports = { ALLOWED, compare, exportedNames, exportSignatures };
