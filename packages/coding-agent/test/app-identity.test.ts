import { describe, expect, it } from "vitest";
import { resolveAppIdentity } from "../src/config.ts";

describe("resolveAppIdentity", () => {
	it("preserves the default Pi identity", () => {
		expect(resolveAppIdentity(undefined)).toEqual({ name: "pi", title: "π" });
	});

	it("preserves a package-configured identity", () => {
		expect(resolveAppIdentity("tau")).toEqual({ name: "tau", title: "tau" });
	});

	it("accepts an embedding app identity without changing package configuration", () => {
		expect(resolveAppIdentity(undefined, { name: "contextox", title: "ContextOx" })).toEqual({
			name: "contextox",
			title: "ContextOx",
		});
	});

	it("ignores empty overrides", () => {
		expect(resolveAppIdentity(undefined, { name: "  ", title: "" })).toEqual({ name: "pi", title: "π" });
	});
});
