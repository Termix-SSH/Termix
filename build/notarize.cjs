const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize macOS DMG builds (not MAS builds - those go through App Store Connect)
  if (electronPlatformName !== 'darwin') {
    console.log(`Skipping notarization: platform is ${electronPlatformName}, not darwin`);
    return;
  }

  // Skip notarization if credentials are not provided
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization: Apple ID credentials not provided');
    console.log(`  APPLE_ID: ${appleId ? 'SET' : 'NOT SET'}`);
    console.log(`  APPLE_ID_PASSWORD: ${appleIdPassword ? 'SET' : 'NOT SET'}`);
    console.log(`  APPLE_TEAM_ID: ${teamId ? 'SET' : 'NOT SET'}`);
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log(`Starting notarization for ${appName}...`);
  console.log(`  App Bundle ID: com.karmaa.termix`);
  console.log(`  App Path: ${appOutDir}/${appName}.app`);
  console.log(`  Team ID: ${teamId}`);

  try {
    await notarize({
      appBundleId: 'com.karmaa.termix',
      appPath: `${appOutDir}/${appName}.app`,
      appleId: appleId,
      appleIdPassword: appleIdPassword,
      teamId: teamId,
    });

    console.log(`✅ Successfully notarized ${appName}`);
  } catch (error) {
    console.error('❌ Notarization failed:', error);
    console.error('Build will continue, but app may show Gatekeeper warnings');
    // Don't fail the build if notarization fails
  }
};
