<TabsContent value="key">
  <div className="space-y-6">
    {/* Private Key Section */}
    <div className="space-y-4">
      <FormLabel className="text-sm font-medium">
        {t("credentials.sshPrivateKey")}
      </FormLabel>

      <div className="grid grid-cols-2 gap-4">
        {/* File Upload */}
        <Controller
          control={form.control}
          name="key"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="text-xs text-muted-foreground">
                {t("hosts.uploadFile")}
              </FormLabel>
              <FormControl>
                <div className="relative inline-block w-full">
                  <input
                    id="key-upload"
                    type="file"
                    accept="*,.pem,.key,.txt,.ppk"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        field.onChange(file);
                        try {
                          const fileContent = await file.text();
                          debouncedKeyDetection(
                            fileContent,
                            form.watch("keyPassword"),
                          );
                        } catch (error) {
                          console.error("Failed to read uploaded file:", error);
                        }
                      }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start text-left"
                  >
                    <span className="truncate">
                      {field.value instanceof File
                        ? field.value.name
                        : t("credentials.upload")}
                    </span>
                  </Button>
                </div>
              </FormControl>
            </FormItem>
          )}
        />

        {/* Text Input */}
        <Controller
          control={form.control}
          name="key"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="text-xs text-muted-foreground">
                {t("hosts.pasteKey")}
              </FormLabel>
              <FormControl>
                <textarea
                  placeholder={t("placeholders.pastePrivateKey")}
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={typeof field.value === "string" ? field.value : ""}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                    debouncedKeyDetection(
                      e.target.value,
                      form.watch("keyPassword"),
                    );
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </div>

      {/* Key type detection display */}
      {detectedKeyType && (
        <div className="text-sm">
          <span className="text-muted-foreground">
            {t("credentials.detectedKeyType")}:{" "}
          </span>
          <span
            className={`font-medium ${
              detectedKeyType === "invalid" || detectedKeyType === "error"
                ? "text-destructive"
                : "text-green-600"
            }`}
          >
            {getFriendlyKeyTypeName(detectedKeyType)}
          </span>
          {keyDetectionLoading && (
            <span className="ml-2 text-muted-foreground">
              ({t("credentials.detecting")}...)
            </span>
          )}
        </div>
      )}

      {/* Show existing private key for editing */}
      {editingCredential && fullCredentialDetails?.key && (
        <FormItem>
          <FormLabel>
            {t("credentials.sshPrivateKey")} ({t("hosts.existingKey")})
          </FormLabel>
          <FormControl>
            <textarea
              readOnly
              className="flex min-h-[120px] w-full rounded-md border border-input bg-muted px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={fullCredentialDetails.key}
            />
          </FormControl>
          <div className="text-xs text-muted-foreground mt-1">
            {t("credentials.currentKeyContent")}
          </div>
          {fullCredentialDetails?.detectedKeyType && (
            <div className="text-sm mt-2">
              <span className="text-muted-foreground">Key type: </span>
              <span className="font-medium text-green-600">
                {getFriendlyKeyTypeName(fullCredentialDetails.detectedKeyType)}
              </span>
            </div>
          )}
        </FormItem>
      )}
    </div>

    {/* Public Key Section */}
    <div className="space-y-4">
      <FormLabel className="text-sm font-medium">
        {t("credentials.sshPublicKey")} ({t("credentials.optional")})
      </FormLabel>

      <div className="grid grid-cols-2 gap-4">
        {/* File Upload */}
        <Controller
          control={form.control}
          name="publicKey"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="text-xs text-muted-foreground">
                {t("hosts.uploadFile")}
              </FormLabel>
              <FormControl>
                <div className="relative inline-block w-full">
                  <input
                    id="public-key-upload"
                    type="file"
                    accept="*,.pub,.txt"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        try {
                          const fileContent = await file.text();
                          field.onChange(fileContent);
                          debouncedPublicKeyDetection(fileContent);
                        } catch (error) {
                          console.error(
                            "Failed to read uploaded public key file:",
                            error,
                          );
                        }
                      }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start text-left"
                  >
                    <span className="truncate">
                      {field.value
                        ? t("credentials.publicKeyUploaded")
                        : t("credentials.uploadPublicKey")}
                    </span>
                  </Button>
                </div>
              </FormControl>
            </FormItem>
          )}
        />

        {/* Text Input */}
        <Controller
          control={form.control}
          name="publicKey"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="text-xs text-muted-foreground">
                {t("hosts.pasteKey")}
              </FormLabel>
              <FormControl>
                <textarea
                  placeholder={t("placeholders.pastePublicKey")}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={field.value || ""}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                    debouncedPublicKeyDetection(e.target.value);
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </div>

      {/* Public key type detection */}
      {detectedPublicKeyType && form.watch("publicKey") && (
        <div className="text-sm">
          <span className="text-muted-foreground">
            {t("credentials.detectedKeyType")}:{" "}
          </span>
          <span
            className={`font-medium ${
              detectedPublicKeyType === "invalid" ||
              detectedPublicKeyType === "error"
                ? "text-destructive"
                : "text-green-600"
            }`}
          >
            {getFriendlyKeyTypeName(detectedPublicKeyType)}
          </span>
          {publicKeyDetectionLoading && (
            <span className="ml-2 text-muted-foreground">
              ({t("credentials.detecting")}...)
            </span>
          )}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {t("credentials.publicKeyNote")}
      </div>

      {/* Show existing public key for editing */}
      {editingCredential && fullCredentialDetails?.publicKey && (
        <FormItem>
          <FormLabel>
            {t("credentials.sshPublicKey")} ({t("hosts.existingKey")})
          </FormLabel>
          <FormControl>
            <textarea
              readOnly
              className="flex min-h-[80px] w-full rounded-md border border-input bg-muted px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={fullCredentialDetails.publicKey}
            />
          </FormControl>
          <div className="text-xs text-muted-foreground mt-1">
            {t("credentials.currentPublicKeyContent")}
          </div>
        </FormItem>
      )}
    </div>

    {/* Generate Public Key Button */}
    {form.watch("key") && (
      <div className="mt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleGeneratePublicKey}
          disabled={generatePublicKeyLoading}
          className="w-full"
        >
          {generatePublicKeyLoading ? (
            <>
              <span className="mr-2">{t("credentials.generating")}...</span>
            </>
          ) : (
            <>
              <span>{t("credentials.generatePublicKey")}</span>
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          {t("credentials.generatePublicKeyNote")}
        </p>
      </div>
    )}
  </div>
</TabsContent>;
