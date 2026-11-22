// Imported first by the frame entry, so every later module sees the shims.
import { installShims } from "./shims";
import { installFrameCapture } from "@/diagnostics/capture";
import { installFormSubmitShim } from "./form-submit";
import { installMenuResizeShim } from "./menu-resize";

installShims();
installFrameCapture();
installFormSubmitShim();
installMenuResizeShim();
