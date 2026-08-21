import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AiProvider } from "@/api/ai-api";

const api = vi.hoisted(() => ({
  createAiProvider: vi.fn(),
  deleteAiProvider: vi.fn(),
  getAiProviderModels: vi.fn(),
  probeAiModels: vi.fn(),
  updateAiProvider: vi.fn(),
}));

vi.mock("@/api/ai-api", () => api);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AiProviderSettings } from "@/features/ai/AiProviderSettings";

const provider: AiProvider = {
  id: 7,
  providerType: "ollama",
  label: "Local Ollama",
  baseUrl: "http://localhost:11434",
  apiKeyPrefix: null,
  defaultModel: "llama3.1",
  enabled: true,
  createdAt: "2026-08-21T00:00:00Z",
};

beforeEach(() => {
  api.getAiProviderModels.mockReset();
  api.getAiProviderModels.mockResolvedValue([]);
  api.updateAiProvider.mockReset();
  api.updateAiProvider.mockResolvedValue(provider);
});

afterEach(cleanup);

describe("AiProviderSettings", () => {
  it("edits an existing provider name and configured model", async () => {
    const onChanged = vi.fn();
    render(<AiProviderSettings providers={[provider]} onChanged={onChanged} />);

    expect(screen.getByText(/llama3\.1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));

    const label = screen.getByLabelText("ai.providerLabel");
    const model = screen.getByLabelText("ai.defaultModel");
    fireEvent.change(label, { target: { value: "Production Ollama" } });
    fireEvent.change(model, { target: { value: "qwen3:32b" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));

    await waitFor(() => {
      expect(api.updateAiProvider).toHaveBeenCalledWith(7, {
        label: "Production Ollama",
        defaultModel: "qwen3:32b",
      });
    });
    expect(onChanged).toHaveBeenCalledWith(7);
  });

  it("loads the saved provider model list when editing starts", async () => {
    api.getAiProviderModels.mockResolvedValue(["llama3.1", "qwen3:32b"]);
    render(<AiProviderSettings providers={[provider]} onChanged={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));

    await waitFor(() => {
      expect(api.getAiProviderModels).toHaveBeenCalledWith(7);
    });
    expect(
      screen.getByRole("combobox", { name: "ai.defaultModel" }),
    ).toBeTruthy();
  });
});
