import React from "react";
import { getAvailableWidgets, type WidgetRegistryItem } from "./registry";
import { Plus, X } from "lucide-react";

interface AddWidgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddWidget: (widgetType: string) => void;
  existingWidgetTypes: string[];
}

export function AddWidgetDialog({
  open,
  onOpenChange,
  onAddWidget,
  existingWidgetTypes,
}: AddWidgetDialogProps) {
  const availableWidgets = getAvailableWidgets();

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />
      <div className="bg-dark-bg border-2 border-dark-border rounded-lg p-6 max-w-[500px] w-full mx-4 relative z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Add Widget</h3>
          <button
            onClick={() => onOpenChange(false)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-gray-400 text-sm mb-4">
          Choose a widget to add to your dashboard
        </p>
        <div className="grid gap-3 max-h-[400px] overflow-y-auto">
          {availableWidgets.map((widget: WidgetRegistryItem) => {
            const Icon = widget.icon;
            return (
              <button
                key={widget.type}
                onClick={() => {
                  onAddWidget(widget.type);
                  onOpenChange(false);
                }}
                className="flex items-start gap-4 p-4 rounded-lg border border-dark-border bg-dark-bg/50 hover:bg-dark-bg hover:border-blue-500/50 transition-all duration-200 text-left group"
              >
                <div
                  className={`flex-shrink-0 w-10 h-10 rounded-lg bg-dark-bg-darker flex items-center justify-center ${widget.iconColor}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-white mb-1 group-hover:text-blue-400 transition-colors">
                    {widget.label}
                  </h4>
                  <p className="text-sm text-gray-400">{widget.description}</p>
                </div>
                <Plus className="flex-shrink-0 h-5 w-5 text-gray-500 group-hover:text-blue-400 transition-colors" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
