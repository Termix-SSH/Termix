// Imported first by the frame entry, so every later module sees the shims.
import { installShims } from "./shims";
import { installFrameCapture } from "@/diagnostics/capture";

installShims();
installFrameCapture();
