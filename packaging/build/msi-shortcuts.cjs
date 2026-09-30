const fs = require("node:fs/promises");

/** Give the generated MSI shortcut its own optional component. */
module.exports = async function msiShortcuts(projectFile) {
  let xml = await fs.readFile(projectFile, "utf8");
  const shortcut = xml.match(/<Shortcut Id="desktopShortcut"[^>]*\/>/g);
  if (
    shortcut?.length !== 1 ||
    !xml.includes('<UIRef Id="WixUI_InstallDir"/>')
  ) {
    throw new Error(
      "Unexpected MSI template: desktop shortcut or assisted UI missing",
    );
  }
  const link = shortcut[0].replace(
    ' Advertise="yes"',
    ' Target="[#mainExecutable]"',
  );
  xml = xml.replace(shortcut[0], "");
  xml = xml.replace(
    '<ComponentGroupRef Id="ProductComponents"/>',
    '<ComponentGroupRef Id="ProductComponents"/>\n      <ComponentRef Id="TermixDesktopShortcut"/>',
  );
  xml = xml.replace(
    "</Product>",
    `
    <Property Id="TERMIX_DESKTOP_SHORTCUT" Value="1" Secure="yes"/>
    <DirectoryRef Id="DesktopFolder">
      <Component Id="TermixDesktopShortcut" Guid="*">
        <Condition>TERMIX_DESKTOP_SHORTCUT = "1"</Condition>
        ${link}
        <RegistryValue Root="HKMU" Key="Software\\Termix" Name="DesktopShortcut" Type="integer" Value="1" KeyPath="yes"/>
      </Component>
    </DirectoryRef>
    <UI>
      <Dialog Id="TermixShortcutDlg" Width="370" Height="270" Title="[ProductName] Setup">
        <Control Id="Title" Type="Text" X="15" Y="15" Width="340" Height="30" Text="Choose shortcuts"/>
        <Control Id="DesktopShortcut" Type="CheckBox" X="20" Y="65" Width="320" Height="20" Property="TERMIX_DESKTOP_SHORTCUT" CheckBoxValue="1" Text="Create a desktop shortcut"/>
        <Control Id="Back" Type="PushButton" X="180" Y="243" Width="56" Height="17" Text="Back">
          <Publish Event="NewDialog" Value="InstallDirDlg">WixAppFolder = "WixPerMachineFolder"</Publish>
          <Publish Event="NewDialog" Value="InstallScopeDlg">WixAppFolder = "WixPerUserFolder"</Publish>
        </Control>
        <Control Id="Next" Type="PushButton" X="236" Y="243" Width="56" Height="17" Default="yes" Text="Next">
          <Publish Event="NewDialog" Value="VerifyReadyDlg">1</Publish>
        </Control>
        <Control Id="Cancel" Type="PushButton" X="304" Y="243" Width="56" Height="17" Cancel="yes" Text="Cancel">
          <Publish Event="SpawnDialog" Value="CancelDlg">1</Publish>
        </Control>
      </Dialog>
    </UI>
  </Product>`,
  );
  xml = xml.replace(
    /(<Publish Dialog="InstallScopeDlg" Control="Next" Event="NewDialog" Value=")VerifyReadyDlg/g,
    "$1TermixShortcutDlg",
  );
  // WixUI_InstallDir also goes to VerifyReadyDlg at Order 4 once the folder
  // is valid, and the last true NewDialog wins, so route after it.
  xml = xml.replace(
    /<Publish Dialog="InstallDirDlg" Control="Next" Event="NewDialog" Value="VerifyReadyDlg" Order="\d+">1<\/Publish>/g,
    '<Publish Dialog="InstallDirDlg" Control="Next" Event="NewDialog" Value="TermixShortcutDlg" Order="5">WIXUI_DONTVALIDATEPATH OR WIXUI_INSTALLDIR_VALID="1"</Publish>',
  );
  xml = xml.replace(
    /(<Publish Dialog="VerifyReadyDlg" Control="Back" Event="NewDialog" Value=")InstallScopeDlg/g,
    "$1TermixShortcutDlg",
  );
  if (
    (xml.match(/Value="TermixShortcutDlg"/g) || []).length !== 3 ||
    !xml.includes('<ComponentRef Id="TermixDesktopShortcut"/>')
  ) {
    throw new Error("Unexpected MSI template: shortcut dialog routing missing");
  }
  await fs.writeFile(projectFile, xml);
};
