import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const customize = require("../../../../packaging/build/msi-shortcuts.cjs") as (
  path: string,
) => Promise<void>;
const { DOMParser } = require("@xmldom/xmldom");
let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const project = `<Wix><Product>
<UIRef Id="WixUI_InstallDir"/>
<UI><Publish Dialog="InstallScopeDlg" Control="Next" Event="NewDialog" Value="VerifyReadyDlg">1</Publish>
<Publish Dialog="InstallDirDlg" Control="Next" Event="NewDialog" Value="VerifyReadyDlg" Order="2">1</Publish>
<Publish Dialog="VerifyReadyDlg" Control="Back" Event="NewDialog" Value="InstallScopeDlg">1</Publish></UI>
<Feature><ComponentGroupRef Id="ProductComponents"/></Feature>
<ComponentGroup><Component><File Id="mainExecutable">
<Shortcut Id="desktopShortcut" Directory="DesktopFolder" Name="Termix" WorkingDirectory="APPLICATIONFOLDER" Advertise="yes" Icon="TermixIcon.exe"/>
<Shortcut Id="startMenuShortcut" Directory="ProgramMenuFolder" Advertise="yes"/>
</File></Component></ComponentGroup>
</Product></Wix>`;

describe("MSI desktop shortcut option", () => {
  it("makes only the desktop shortcut conditional and connects both installation scopes to its page", async () => {
    dir = await mkdtemp(join(tmpdir(), "termix-msi-"));
    const file = join(dir, "project.wxs");
    await writeFile(file, project);
    await customize(file);
    const xml = await readFile(file, "utf8");
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const elements = (name: string) =>
      Array.from(doc.getElementsByTagName(name)) as Element[];
    const desktop = elements("Shortcut").find(
      (node) => node.getAttribute("Id") === "desktopShortcut",
    )!;
    expect(desktop.getAttribute("Target")).toBe("[#mainExecutable]");
    expect(desktop.getAttribute("Advertise")).toBeFalsy();
    expect((desktop.parentNode as Element).getAttribute("Id")).toBe(
      "TermixDesktopShortcut",
    );
    expect(elements("Condition")[0].textContent).toBe(
      'TERMIX_DESKTOP_SHORTCUT = "1"',
    );
    expect(
      elements("Shortcut")
        .find((node) => node.getAttribute("Id") === "startMenuShortcut")!
        .getAttribute("Advertise"),
    ).toBe("yes");
    expect(
      elements("Publish").filter(
        (node) => node.getAttribute("Value") === "TermixShortcutDlg",
      ),
    ).toHaveLength(3);
    const installDir = elements("Publish").find(
      (node) =>
        node.getAttribute("Dialog") === "InstallDirDlg" &&
        node.getAttribute("Value") === "TermixShortcutDlg",
    )!;
    // Must run after WixUI_InstallDir's own VerifyReadyDlg event (Order 4).
    expect(Number(installDir.getAttribute("Order"))).toBeGreaterThan(4);
    expect(installDir.textContent).toBe(
      'WIXUI_DONTVALIDATEPATH OR WIXUI_INSTALLDIR_VALID="1"',
    );
    expect(
      elements("Control")
        .find((node) => node.getAttribute("Type") === "CheckBox")!
        .getAttribute("Property"),
    ).toBe("TERMIX_DESKTOP_SHORTCUT");
  });

  it("accepts the installed electron-builder MSI template", async () => {
    const template = await readFile(
      require.resolve("app-builder-lib/templates/msi/template.xml"),
      "utf8",
    );
    const xml = require("ejs").render(
      template
        .replace(/{{/g, "<%")
        .replace(/}}/g, "%>")
        .replace(/\$\{([^}]+)}/g, "<%=$1%>"),
      {
        productName: "Termix",
        upgradeCode: "9A4E27D1-6F54-4B15-ABBD-54B194CB7200",
        version: "2.9.0",
        manufacturer: "Termix",
        compressionLevel: "high",
        installationDirectoryWixName: "Termix",
        iconPath: null,
        isRunAfterFinish: false,
        isAssisted: true,
        isPerMachine: false,
        programFilesId: "ProgramFiles64Folder",
        menuCategory: null,
        isCreateDesktopShortcut: true,
        isCreateStartMenuShortcut: true,
        dirs: "",
        files:
          '<Component Id="Main" Guid="*"><File Id="mainExecutable" Source="Termix.exe"><Shortcut Id="desktopShortcut" Directory="DesktopFolder" Name="Termix" Advertise="yes"/></File></Component>',
      },
    );
    dir = await mkdtemp(join(tmpdir(), "termix-msi-"));
    const file = join(dir, "project.wxs");
    await writeFile(file, xml);
    await customize(file);
    const result = await readFile(file, "utf8");
    expect(result.match(/Value="TermixShortcutDlg"/g)).toHaveLength(3);
    expect(result).toContain('RegistryValue Root="HKMU"');
    expect(result).toContain('<ComponentRef Id="TermixDesktopShortcut"/>');
  });

  it("stops the build if the generated installer template changes", async () => {
    dir = await mkdtemp(join(tmpdir(), "termix-msi-"));
    const file = join(dir, "project.wxs");
    await writeFile(file, "<Wix/>");
    await expect(customize(file)).rejects.toThrow("Unexpected MSI template");
    expect(await readFile(file, "utf8")).toBe("<Wix/>");
  });
});
