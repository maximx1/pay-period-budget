import { describe, expect, it } from "vitest";
import { splitLinks } from "./links.ts";

const text = (value: string) => ({ type: "text", value });
const link = (value: string) => ({ type: "link", value });

describe("splitLinks", () => {
  it("leaves plain text alone", () => {
    expect(splitLinks("Paid by autopay on the 25th.")).toEqual([text("Paid by autopay on the 25th.")]);
    expect(splitLinks("")).toEqual([]);
  });

  it("finds a URL in the middle of a sentence", () => {
    expect(splitLinks("Pay at https://example.com/pay before noon")).toEqual([
      text("Pay at "),
      link("https://example.com/pay"),
      text(" before noon"),
    ]);
  });

  it("keeps sentence punctuation out of the link", () => {
    expect(splitLinks("See https://example.com/bill.")).toEqual([text("See "), link("https://example.com/bill"), text(".")]);
    expect(splitLinks("Really, https://example.com?!")).toEqual([text("Really, "), link("https://example.com"), text("?!")]);
    expect(splitLinks("Both: https://a.example, https://b.example;")).toEqual([
      text("Both: "),
      link("https://a.example"),
      text(", "),
      link("https://b.example"),
      text(";"),
    ]);
  });

  it("handles a URL wrapped in brackets", () => {
    expect(splitLinks("Portal (https://example.com/login) is slow")).toEqual([
      text("Portal ("),
      link("https://example.com/login"),
      text(") is slow"),
    ]);
  });

  it("keeps brackets that are part of the address", () => {
    expect(splitLinks("https://en.wikipedia.org/wiki/Budget_(disambiguation)")).toEqual([
      link("https://en.wikipedia.org/wiki/Budget_(disambiguation)"),
    ]);
  });

  it("keeps query strings and fragments", () => {
    expect(splitLinks("https://example.com/pay?acct=123&due=25#summary")).toEqual([
      link("https://example.com/pay?acct=123&due=25#summary"),
    ]);
  });

  it("finds links on separate lines and keeps the line breaks", () => {
    expect(splitLinks("Account 123\nhttps://example.com\nhttp://old.example/x")).toEqual([
      text("Account 123\n"),
      link("https://example.com"),
      text("\n"),
      link("http://old.example/x"),
    ]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.com/file",
    "www.example.com",
    "mailto:someone@example.com",
    "https://",
    "http://.",
  ])("treats %j as text", (value) => {
    expect(splitLinks(`before ${value} after`)).toEqual([text(`before ${value} after`)]);
  });

  it("only ever yields http and https links", () => {
    const parts = splitLinks('click <a href="javascript:alert(1)">https://safe.example</a> or JAVASCRIPT:alert(1)');
    expect(parts.filter((part) => part.type === "link")).toEqual([link("https://safe.example")]);
  });
});
