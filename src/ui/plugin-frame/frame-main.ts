// Entry of the plugin frame page. The shims must be in place before any core
// or plugin module runs, and the bundler evaluates shared chunks before an
// entry's own code, so everything else loads after them.
import "./install-shims";

void import("./frame-boot");
