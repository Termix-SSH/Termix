const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  // Skip notarization for non-macOS platforms
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Skip notarization for Mac App Store builds (MAS)
  // MAS builds are notarized by Apple during App Store review
  const target = packager.platformSpecificBuildOptions.target || [];
  const isMasBuild = Array.isArray(target)
    ? target.some(t => t.target === 'mas' || t === 'mas')
    : target === 'mas';

  if (isMasBuild || appOutDir.includes('mas')) {
    console.log('Skipping notarization for Mac App Store build');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  // Skip if credentials not provided (for unsigned builds)
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization: credentials not provided');
    return;
  }

  console.log('Starting notarization process...');
  try {
    await notarize({
      appPath: appPath,
      appleId: appleId,
      appleIdPassword: appleIdPassword,
      teamId: teamId,
    });
    console.log('Notarization completed successfully');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
