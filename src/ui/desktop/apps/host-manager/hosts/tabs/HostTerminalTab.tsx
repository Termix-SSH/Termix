import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command.tsx";
import { Slider } from "@/components/ui/slider.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import {
  TERMINAL_THEMES,
  TERMINAL_FONTS,
  CURSOR_STYLES,
  BELL_STYLES,
  FAST_SCROLL_MODIFIERS,
} from "@/constants/terminal-themes.ts";
import { TerminalPreview } from "@/ui/desktop/apps/features/terminal/TerminalPreview.tsx";
import type { HostTerminalTabProps } from "./shared/tab-types";
import React from "react";

export function HostTerminalTab({ form, snippets, t }: HostTerminalTabProps) {
  const [snippetPopoverOpen, setSnippetPopoverOpen] = React.useState(false);
  return (
    <div className="space-y-1">
      <FormField
        control={form.control}
        name="enableTerminal"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("hosts.enableTerminal")}</FormLabel>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormDescription>{t("hosts.enableTerminalDesc")}</FormDescription>
          </FormItem>
        )}
      />
      <h1 className="text-xl font-semibold mt-7">
        {t("hosts.terminalCustomization")}
      </h1>
      <Accordion
        type="multiple"
        className="w-full"
        defaultValue={["appearance", "behavior", "advanced"]}
      >
        <AccordionItem value="appearance">
          <AccordionTrigger>{t("hosts.appearance")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("hosts.themePreview")}
              </label>
              <TerminalPreview
                theme={form.watch("terminalConfig.theme")}
                fontSize={form.watch("terminalConfig.fontSize")}
                fontFamily={form.watch("terminalConfig.fontFamily")}
                cursorStyle={form.watch("terminalConfig.cursorStyle")}
                cursorBlink={form.watch("terminalConfig.cursorBlink")}
                letterSpacing={form.watch("terminalConfig.letterSpacing")}
                lineHeight={form.watch("terminalConfig.lineHeight")}
              />
            </div>

            <FormField
              control={form.control}
              name="terminalConfig.theme"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("hosts.theme")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("hosts.selectTheme")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(TERMINAL_THEMES).map(([key, theme]) => (
                        <SelectItem key={key} value={key}>
                          {theme.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t("hosts.chooseColorTheme")}
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.fontFamily"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("hosts.fontFamily")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("hosts.selectFont")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TERMINAL_FONTS.map((font) => (
                        <SelectItem key={font.value} value={font.value}>
                          {font.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{t("hosts.selectFontDesc")}</FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.fontSize"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("hosts.fontSizeValue", {
                      value: field.value,
                    })}
                  </FormLabel>
                  <FormControl>
                    <Slider
                      min={8}
                      max={24}
                      step={1}
                      value={[field.value]}
                      onValueChange={([value]) => field.onChange(value)}
                    />
                  </FormControl>
                  <FormDescription>{t("hosts.adjustFontSize")}</FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.letterSpacing"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("hosts.letterSpacingValue", {
                      value: field.value,
                    })}
                  </FormLabel>
                  <FormControl>
                    <Slider
                      min={-2}
                      max={10}
                      step={0.5}
                      value={[field.value]}
                      onValueChange={([value]) => field.onChange(value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("hosts.adjustLetterSpacing")}
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.lineHeight"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("hosts.lineHeightValue", {
                      value: field.value,
                    })}
                  </FormLabel>
                  <FormControl>
                    <Slider
                      min={1}
                      max={2}
                      step={0.1}
                      value={[field.value]}
                      onValueChange={([value]) => field.onChange(value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("hosts.adjustLineHeight")}
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.cursorStyle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("hosts.cursorStyle")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t("hosts.selectCursorStyle")}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="block">
                        {t("hosts.cursorStyleBlock")}
                      </SelectItem>
                      <SelectItem value="underline">
                        {t("hosts.cursorStyleUnderline")}
                      </SelectItem>
                      <SelectItem value="bar">
                        {t("hosts.cursorStyleBar")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t("hosts.chooseCursorAppearance")}
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.cursorBlink"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                  <div className="space-y-0.5">
                    <FormLabel>{t("hosts.cursorBlink")}</FormLabel>
                    <FormDescription>
                      {t("hosts.enableCursorBlink")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="behavior">
          <AccordionTrigger>{t("hosts.behavior")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="terminalConfig.scrollback"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("hosts.scrollbackBufferValue", {
                      value: field.value,
                    })}
                  </FormLabel>
                  <FormControl>
                    <Slider
                      min={1000}
                      max={100000}
                      step={1000}
                      value={[field.value]}
                      onValueChange={([value]) => field.onChange(value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("hosts.scrollbackBufferDesc")}
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.bellStyle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("hosts.bellStyle")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("hosts.selectBellStyle")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">
                        {t("hosts.bellStyleNone")}
                      </SelectItem>
                      <SelectItem value="sound">
                        {t("hosts.bellStyleSound")}
                      </SelectItem>
                      <SelectItem value="visual">
                        {t("hosts.bellStyleVisual")}
                      </SelectItem>
                      <SelectItem value="both">
                        {t("hosts.bellStyleBoth")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>{t("hosts.bellStyleDesc")}</FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.rightClickSelectsWord"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                  <div className="space-y-0.5">
                    <FormLabel>{t("hosts.rightClickSelectsWord")}</FormLabel>
                    <FormDescription>
                      {t("hosts.rightClickSelectsWordDesc")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.fastScrollModifier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("hosts.fastScrollModifier")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("hosts.selectModifier")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="alt">
                        {t("hosts.modifierAlt")}
                      </SelectItem>
                      <SelectItem value="ctrl">
                        {t("hosts.modifierCtrl")}
                      </SelectItem>
                      <SelectItem value="shift">
                        {t("hosts.modifierShift")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t("hosts.fastScrollModifierDesc")}
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.fastScrollSensitivity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("hosts.fastScrollSensitivityValue", {
                      value: field.value,
                    })}
                  </FormLabel>
                  <FormControl>
                    <Slider
                      min={1}
                      max={10}
                      step={1}
                      value={[field.value]}
                      onValueChange={([value]) => field.onChange(value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("hosts.fastScrollSensitivityDesc")}
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.minimumContrastRatio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("hosts.minimumContrastRatioValue", {
                      value: field.value,
                    })}
                  </FormLabel>
                  <FormControl>
                    <Slider
                      min={1}
                      max={21}
                      step={1}
                      value={[field.value]}
                      onValueChange={([value]) => field.onChange(value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("hosts.minimumContrastRatioDesc")}
                  </FormDescription>
                </FormItem>
              )}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="advanced">
          <AccordionTrigger>{t("hosts.advanced")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="terminalConfig.agentForwarding"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                  <div className="space-y-0.5">
                    <FormLabel>{t("hosts.sshAgentForwarding")}</FormLabel>
                    <FormDescription>
                      {t("hosts.sshAgentForwardingDesc")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.backspaceMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("hosts.backspaceMode")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t("hosts.selectBackspaceMode")}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="normal">
                        {t("hosts.backspaceModeNormal")}
                      </SelectItem>
                      <SelectItem value="control-h">
                        {t("hosts.backspaceModeControlH")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t("hosts.backspaceModeDesc")}
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminalConfig.startupSnippetId"
              render={({ field }) => {
                const open = snippetPopoverOpen;
                const setOpen = setSnippetPopoverOpen;
                const selectedSnippet = snippets.find(
                  (s) => s.id === field.value,
                );

                return (
                  <FormItem>
                    <FormLabel>{t("hosts.startupSnippet")}</FormLabel>
                    <Popover open={open} onOpenChange={setOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={open}
                            className="w-full justify-between"
                          >
                            {selectedSnippet
                              ? selectedSnippet.name
                              : t("hosts.selectSnippet")}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent
                        className="p-0"
                        style={{
                          width: "var(--radix-popover-trigger-width)",
                        }}
                      >
                        <Command>
                          <CommandInput
                            placeholder={t("hosts.searchSnippets")}
                          />
                          <CommandEmpty>
                            {t("hosts.noSnippetFound")}
                          </CommandEmpty>
                          <CommandGroup className="max-h-[300px] overflow-y-auto thin-scrollbar">
                            <CommandItem
                              value="none"
                              onSelect={() => {
                                field.onChange(null);
                                setOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  !field.value ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {t("hosts.snippetNone")}
                            </CommandItem>
                            {snippets.map((snippet) => (
                              <CommandItem
                                key={snippet.id}
                                value={`${snippet.name} ${snippet.content} ${snippet.id}`}
                                onSelect={() => {
                                  field.onChange(snippet.id);
                                  setOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    field.value === snippet.id
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                <div className="flex flex-col">
                                  <span className="font-medium">
                                    {snippet.name}
                                  </span>
                                  <span className="text-xs text-muted-foreground truncate max-w-[350px]">
                                    {snippet.content}
                                  </span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormDescription>
                      {t("hosts.executeSnippetOnConnect")}
                    </FormDescription>
                  </FormItem>
                );
              }}
            />

            <FormField
              control={form.control}
              name="terminalConfig.autoMosh"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                  <div className="space-y-0.5">
                    <FormLabel>{t("hosts.autoMosh")}</FormLabel>
                    <FormDescription>{t("hosts.autoMoshDesc")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {form.watch("terminalConfig.autoMosh") && (
              <FormField
                control={form.control}
                name="terminalConfig.moshCommand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("hosts.moshCommand")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("placeholders.moshCommand")}
                        {...field}
                        onBlur={(e) => {
                          field.onChange(e.target.value.trim());
                          field.onBlur();
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("hosts.moshCommandDesc")}
                    </FormDescription>
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="terminalConfig.sudoPasswordAutoFill"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                  <div className="space-y-0.5">
                    <FormLabel>{t("hosts.sudoPasswordAutoFill")}</FormLabel>
                    <FormDescription>
                      {t("hosts.sudoPasswordAutoFillDesc")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {form.watch("terminalConfig.sudoPasswordAutoFill") && (
              <FormField
                control={form.control}
                name="terminalConfig.sudoPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("hosts.sudoPassword")}</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder={t("placeholders.sudoPassword")}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("hosts.sudoPasswordDesc")}
                    </FormDescription>
                  </FormItem>
                )}
              />
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("hosts.environmentVariables")}
              </label>
              <FormDescription>
                {t("hosts.environmentVariablesDesc")}
              </FormDescription>
              {form
                .watch("terminalConfig.environmentVariables")
                ?.map((_, index) => (
                  <div key={index} className="flex gap-2">
                    <FormField
                      control={form.control}
                      name={`terminalConfig.environmentVariables.${index}.key`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input
                              placeholder={t("hosts.variableName")}
                              {...field}
                              onBlur={(e) => {
                                field.onChange(e.target.value.trim());
                                field.onBlur();
                              }}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`terminalConfig.environmentVariables.${index}.value`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input
                              placeholder={t("hosts.variableValue")}
                              {...field}
                              onBlur={(e) => {
                                field.onChange(e.target.value.trim());
                                field.onBlur();
                              }}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        const current = form.getValues(
                          "terminalConfig.environmentVariables",
                        );
                        form.setValue(
                          "terminalConfig.environmentVariables",
                          current.filter((_, i) => i !== index),
                        );
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const current =
                    form.getValues("terminalConfig.environmentVariables") || [];
                  form.setValue("terminalConfig.environmentVariables", [
                    ...current,
                    { key: "", value: "" },
                  ]);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t("hosts.addVariable")}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
