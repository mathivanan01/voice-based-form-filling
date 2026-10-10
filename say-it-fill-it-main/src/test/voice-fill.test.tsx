import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Route } from "@/routes/index";

describe("MozhiFill AI Form Interface", () => {
  it("renders all 10 form fields correctly", () => {
    const Component = (Route as any).options?.component;
    expect(Component).toBeDefined();
    render(<Component />);

    expect(screen.getAllByText("MozhiFill AI").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Full name")).toBeDefined();
    expect(screen.getByText("Age")).toBeDefined();
    expect(screen.getByText("Gender")).toBeDefined();
    expect(screen.getByText("Date of birth")).toBeDefined();
    expect(screen.getByText("Phone")).toBeDefined();
    expect(screen.getByText("Email")).toBeDefined();
    expect(screen.getByText("Address")).toBeDefined();
    expect(screen.getByText("City")).toBeDefined();
    expect(screen.getByText("Pincode")).toBeDefined();
    expect(screen.getByText("Occupation")).toBeDefined();
  });

  it("allows language switching between English, Tamil, and Tanglish", () => {
    const Component = (Route as any).options?.component;
    render(<Component />);

    const englishBtn = screen.getByText("English");
    const tamilBtn = screen.getByText("தமிழ்");
    const tanglishBtn = screen.getByText("Tanglish");

    expect(englishBtn).toBeDefined();
    expect(tamilBtn).toBeDefined();
    expect(tanglishBtn).toBeDefined();

    fireEvent.click(tamilBtn);
    expect(screen.getByText(/என் பெயர் ரவி குமார்/)).toBeDefined();

    fireEvent.click(englishBtn);
    expect(screen.getByText(/My name is Ravi Kumar/)).toBeDefined();
  });
});
