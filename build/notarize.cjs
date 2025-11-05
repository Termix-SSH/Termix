const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  try {
    await notarize({
      appBundleId: 'com.karmaa.termix',
      appPath: `${appOutDir}/${appName}.app`,
      appleId: appleId,
      appleIdPassword: appleIdPassword,
      teamId: teamId,
    });
  } catch (error) {
    console.error('Notarization failed:', error);
  }
};
