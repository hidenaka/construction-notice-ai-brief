const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

const DEFAULT_DELIVERABLES = [
  {
    id: "qr",
    label: "住民向けQRページ",
    description: "現場看板や配布物から開ける確認済み周知ページ",
  },
  {
    id: "a4",
    label: "A4周知チラシ",
    description: "既存資料の確認済み項目から生成する配布物",
  },
  {
    id: "changeHistory",
    label: "変更履歴",
    description: "公開後の変更、確認者、再承認を残す履歴",
  },
  {
    id: "ownerReport",
    label: "発注者向けレポート",
    description: "公開日時、確認者、閲覧数、問い合わせカテゴリの報告",
  },
];

const DEFAULT_INQUIRY_CATEGORIES = ["通行可否", "工期", "騒音", "迂回路", "その他"];

const HUMAN_APPROVAL_SCOPE = [
  "公開前承認",
  "低信頼度・要確認項目の確認",
  "変更時の再承認",
  "問い合わせカテゴリ確認",
];

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && item !== "");
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function toIsoString(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function generatedAt(options) {
  return toIsoString(options && options.now ? options.now : new Date());
}

function round2(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function averageConfidence(fields) {
  if (!fields.length) return 0;
  return round2(fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length);
}

function confidenceValue(value, fallback = 0) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return fallback;
  return Math.max(0, Math.min(1, confidence));
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function fieldValue(draft, item) {
  if (hasValue(item.value)) return item.value;
  if (item.id && hasValue(draft[item.id])) return draft[item.id];
  return item.value;
}

function evidenceEntry(draft, item) {
  if (item.evidence !== undefined) return item.evidence;
  const evidence = safeObject(draft.evidence);
  return evidence[item.id];
}

function evidenceText(evidence) {
  if (typeof evidence === "string") return evidence;
  const entry = safeObject(evidence);
  return entry.quote || entry.text || entry.value || "";
}

function evidenceSource(evidence, item) {
  const entry = safeObject(evidence);
  return item.source || item.sourceUrl || entry.source || entry.sourceUrl || entry.document || entry.file || "";
}

function evidenceDocumentId(evidence, item) {
  const entry = safeObject(evidence);
  return (
    item.sourceDocumentId ||
    item.documentId ||
    entry.sourceDocumentId ||
    entry.documentId ||
    (entry.document && entry.document.id) ||
    null
  );
}

function itemConfidence(evidence, item, value) {
  if (item.confidence !== undefined) return confidenceValue(item.confidence);
  const entry = safeObject(evidence);
  if (entry.confidence !== undefined) return confidenceValue(entry.confidence);
  return hasValue(value) ? 1 : 0;
}

function fieldRequiresConfirmation(draft, item, options) {
  const draftRequired = asArray(draft.requiresConfirmation);
  const optionRequired = asArray(options.requiresConfirmation);
  return (
    Boolean(item.requiresConfirmation) ||
    draftRequired.includes(item.id) ||
    optionRequired.includes(item.id) ||
    (item.id === "dates" && (draftRequired.includes("startAt") || draftRequired.includes("endAt")))
  );
}

function approvedFieldState(options) {
  const raw = options.approvedFields !== undefined ? options.approvedFields : options.approvedFieldIds;
  const confirmedRaw = options.confirmedFields !== undefined ? options.confirmedFields : options.confirmedFieldIds;
  return {
    hasApprovedList: raw !== undefined,
    approvedFields: new Set(asArray(raw)),
    confirmedFields: new Set(asArray(confirmedRaw)),
  };
}

function statusSummary(items) {
  return {
    totalFields: items.length,
    approvedCount: items.filter((item) => item.status === "approved").length,
    needsConfirmationCount: items.filter((item) => item.status === "needs_confirmation").length,
    blockedCount: items.filter((item) => item.status === "blocked").length,
  };
}

function reportStatusFromReview(review) {
  if (review.status === "approved") return "published";
  return review.status;
}

function normalizeReviewItem(draft, item, options, approvalState) {
  const value = fieldValue(draft, item);
  const evidence = evidenceEntry(draft, item);
  const confidence = itemConfidence(evidence, item, value);
  const missing = !hasValue(value);
  const threshold = Number.isFinite(Number(options.confidenceThreshold))
    ? Number(options.confidenceThreshold)
    : DEFAULT_CONFIDENCE_THRESHOLD;
  const requiresConfirmation = fieldRequiresConfirmation(draft, item, options);
  const needsReview = Boolean(item.needsReview);
  const humanConfirmed = approvalState.confirmedFields.has(item.id);
  const reasons = [];

  if (missing) {
    reasons.push("missing");
  } else {
    if (confidence < threshold) reasons.push(humanConfirmed ? "human_confirmed_low_confidence" : "low_confidence");
    if (requiresConfirmation) reasons.push(humanConfirmed ? "human_confirmed_required" : "requires_confirmation");
    if (needsReview && confidence >= threshold && !requiresConfirmation) reasons.push(humanConfirmed ? "human_confirmed_review" : "review_required");
  }

  if (
    !missing &&
    confidence >= threshold &&
    !requiresConfirmation &&
    !needsReview &&
    approvalState.hasApprovedList &&
    !approvalState.approvedFields.has(item.id)
  ) {
    reasons.push("not_approved");
  }

  const unresolvedReasons = reasons.filter((reason) => !String(reason).startsWith("human_confirmed"));
  const status = missing || item.blocked
    ? "blocked"
    : unresolvedReasons.length
      ? "needs_confirmation"
      : "approved";

  return {
    id: item.id,
    label: item.label || item.id,
    value: hasValue(value) ? value : "",
    evidence: evidenceText(evidence),
    source: evidenceSource(evidence, item),
    sourceDocumentId: evidenceDocumentId(evidence, item),
    confidence,
    status,
    humanConfirmed,
    reasons,
  };
}

function normalizeDeliverables(deliverables) {
  const source = deliverables && deliverables.length ? deliverables : DEFAULT_DELIVERABLES;
  return source.map((item) => {
    if (typeof item === "string") {
      return {
        id: item,
        label: item,
        included: true,
      };
    }
    return {
      id: item.id || item.label,
      label: item.label || item.id,
      description: item.description || "",
      included: item.included !== false,
    };
  });
}

function normalizeInquiryCategories(categories) {
  if (Array.isArray(categories)) {
    return categories.map((item) => {
      if (typeof item === "string") return { category: item, count: 0 };
      return {
        category: item.category || item.label || item.id || "その他",
        count: Number.isFinite(Number(item.count)) ? Number(item.count) : 0,
      };
    });
  }

  const categoryMap = safeObject(categories);
  const entries = Object.entries(categoryMap);
  if (entries.length) {
    return entries.map(([category, count]) => ({
      category,
      count: Number.isFinite(Number(count)) ? Number(count) : 0,
    }));
  }

  return DEFAULT_INQUIRY_CATEGORIES.map((category) => ({ category, count: 0 }));
}

function normalizeMetrics(metrics) {
  const source = safeObject(metrics);
  return {
    views: Number.isFinite(Number(source.views)) ? Number(source.views) : 0,
    uniqueViews: Number.isFinite(Number(source.uniqueViews)) ? Number(source.uniqueViews) : 0,
    inquiries: Number.isFinite(Number(source.inquiries)) ? Number(source.inquiries) : 0,
    lastViewedAt: source.lastViewedAt || null,
  };
}

function normalizeTransitImpact(impact) {
  const source = safeObject(impact);
  const summary = safeObject(source.summary);
  const dataSource = safeObject(source.dataSource);
  const routes = asArray(source.affectedAccessRoutes).map((route) => {
    const item = safeObject(route);
    const stop = safeObject(item.stop);
    return {
      label: item.label || item.destinationName || "",
      relation: item.relation || "",
      severity: item.severity || "",
      distanceToConstructionMeters: Number.isFinite(Number(item.distanceToConstructionMeters))
        ? Number(item.distanceToConstructionMeters)
        : null,
      distanceMeters: Number.isFinite(Number(item.distanceMeters)) ? Number(item.distanceMeters) : null,
      stopName: stop.name || item.stopName || item.stopId || "",
    };
  });
  return {
    affectedCount: Number.isFinite(Number(summary.affectedCount)) ? Number(summary.affectedCount) : routes.length,
    highCount: Number.isFinite(Number(summary.highCount)) ? Number(summary.highCount) : routes.filter((route) => route.severity === "high").length,
    mediumCount: Number.isFinite(Number(summary.mediumCount)) ? Number(summary.mediumCount) : routes.filter((route) => route.severity === "medium").length,
    sentence: summary.sentence || "",
    sourceLabel: dataSource.sourceLabel || source.sourceLabel || "",
    accessRouteSource: dataSource.accessRouteSource || source.accessRouteSource || "",
    affectedAccessRoutes: routes,
  };
}

function normalizeProject(payload, draft) {
  const project = safeObject(payload.project);
  return {
    title: project.title || draft.title || "",
    startAt: project.startAt || draft.startAt || null,
    endAt: project.endAt || draft.endAt || null,
    timeWindow: project.timeWindow || draft.timeWindow || null,
    restrictionType: project.restrictionType || draft.restrictionType || null,
    owner: project.owner || draft.owner || null,
    contractor: project.contractor || draft.contractor || null,
    client: project.client || draft.client || null,
    location: project.location || draft.location || null,
    contact: project.contact || draft.contact || null,
  };
}

function normalizedCoordinatePair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const lng = Number(pair[0]);
  const lat = Number(pair[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function normalizedCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return [];
  return coordinates.map(normalizedCoordinatePair).filter(Boolean);
}

function normalizeMap(payload, draft) {
  const source = safeObject(payload.map);
  const draftMap = safeObject(draft.mapCandidate || draft.routeCandidate || draft.map);
  const map = Object.keys(source).length ? source : draftMap;
  const coordinates = normalizedCoordinates(map.coordinates || map.roadAxis);
  return {
    ...map,
    coordinates,
    pointCount: coordinates.length,
    laneSummary: map.laneSummary || map.summary || draft.laneSummary || "",
  };
}

function normalizeSourceDocuments(payload, draft) {
  return asArray(payload.sourceDocuments || draft.sourceDocuments || draft.documents).map((document) => {
    if (typeof document === "string") {
      return {
        id: document,
        name: document,
        type: "document",
      };
    }
    return {
      id: document.id || document.name || document.filename,
      name: document.name || document.filename || document.id,
      type: document.type || "document",
      url: document.url || undefined,
    };
  });
}

function normalizeChangeHistory(history) {
  return asArray(history).map((entry) => {
    if (typeof entry === "string") {
      return {
        changedAt: null,
        summary: entry,
        approvedBy: null,
      };
    }
    return {
      changedAt: toIsoString(entry.changedAt || entry.publishedAt || entry.createdAt),
      summary: entry.summary || entry.label || entry.description || "",
      approvedBy: entry.approvedBy || entry.confirmedBy || null,
    };
  });
}

function validationSummary(fields) {
  return {
    totalFields: fields.length,
    confirmedCount: fields.filter((field) => field.status === "approved").length,
    needsConfirmationCount: fields.filter((field) => field.status === "needs_confirmation").length,
    blockedCount: fields.filter((field) => field.status === "blocked").length,
    averageConfidence: averageConfidence(fields),
  };
}

function documentValidationRecords(sourceDocuments, fields) {
  return sourceDocuments.map((document) => {
    const documentFields = fields.filter((field) => field.sourceDocumentId === document.id);
    const summary = validationSummary(documentFields);
    return {
      id: document.id,
      name: document.name,
      type: document.type,
      fieldCount: summary.totalFields,
      confirmedCount: summary.confirmedCount,
      needsConfirmationCount: summary.needsConfirmationCount,
      blockedCount: summary.blockedCount,
      averageConfidence: summary.averageConfidence,
    };
  });
}

export function buildSafetyReview(draft, reviewItems, options = {}) {
  const sourceDraft = safeObject(draft);
  const items = asArray(reviewItems);
  const approvalState = approvedFieldState(options);
  const normalizedItems = items.map((item) => normalizeReviewItem(sourceDraft, safeObject(item), options, approvalState));
  const summary = statusSummary(normalizedItems);
  const status = normalizedItems.length === 0
    ? "draft"
    : summary.blockedCount > 0
    ? "blocked"
    : summary.needsConfirmationCount > 0
      ? "needs_confirmation"
      : "approved";

  return {
    status,
    generatedAt: generatedAt(options),
    confidenceThreshold: Number.isFinite(Number(options.confidenceThreshold))
      ? Number(options.confidenceThreshold)
      : DEFAULT_CONFIDENCE_THRESHOLD,
    controls: {
      aiOcrRole: "draft_only",
      evidenceRequired: true,
      sourceRequired: true,
      confidenceRequired: true,
      humanApprovalRequired: true,
      reapprovalRequiredForChanges: true,
    },
    summary,
    items: normalizedItems,
    confirmationRequired: normalizedItems
      .filter((item) => item.status !== "approved")
      .map((item) => ({ id: item.id, label: item.label, status: item.status, reasons: item.reasons })),
  };
}

export function buildValidationRecord(draft, reviewItems, options = {}) {
  const sourceDraft = safeObject(draft);
  const safetyReview = buildSafetyReview(sourceDraft, reviewItems, options);
  const sourceDocuments = normalizeSourceDocuments({}, sourceDraft);
  const fields = safetyReview.items.map((item) => ({
    id: item.id,
    label: item.label,
    value: item.value,
    evidence: item.evidence,
    source: item.source,
    sourceDocumentId: item.sourceDocumentId,
    confidence: item.confidence,
    status: item.status,
    reasons: item.reasons,
  }));

  return {
    generatedAt: generatedAt(options),
    sourceDocuments,
    summary: validationSummary(fields),
    fields,
    documents: documentValidationRecords(sourceDocuments, fields),
  };
}

export function buildOwnerReport(payload, options = {}) {
  const sourcePayload = safeObject(payload);
  const draft = safeObject(sourcePayload.draft || sourcePayload);
  const reviewItems = sourcePayload.reviewItems || sourcePayload.review || [];
  const safetyReview = sourcePayload.safetyReview || buildSafetyReview(draft, reviewItems, options);
  const publishedAt = toIsoString(sourcePayload.publishedAt || options.publishedAt || options.now || new Date());
  const confirmedBy = asArray(sourcePayload.confirmedBy || options.confirmedBy || draft.confirmedBy);

  return {
    status: sourcePayload.status || reportStatusFromReview(safetyReview),
    publishedAt,
    confirmedBy,
    publicUrl: sourcePayload.publicUrl || options.publicUrl || null,
    sourceDocuments: normalizeSourceDocuments(sourcePayload, draft),
    deliverables: normalizeDeliverables(sourcePayload.deliverables || options.deliverables),
    changeHistory: normalizeChangeHistory(sourcePayload.changeHistory || []),
    metrics: normalizeMetrics(sourcePayload.metrics),
    inquiryCategories: normalizeInquiryCategories(sourcePayload.inquiryCategories),
    project: normalizeProject(sourcePayload, draft),
    map: normalizeMap(sourcePayload, draft),
    transitImpact: normalizeTransitImpact(sourcePayload.lastMileImpact || sourcePayload.transitImpact),
    safetyReview,
  };
}

export function buildPilotPackage(report, options = {}) {
  const sourceReport = safeObject(report);
  return {
    name: "工事周知 半自動代行パック",
    priceRange: "5万〜8万円/現場",
    generatedAt: generatedAt(options),
    reportStatus: sourceReport.status || "draft",
    publicUrl: sourceReport.publicUrl || null,
    deliverables: normalizeDeliverables(options.deliverables || DEFAULT_DELIVERABLES),
    sourceDocuments: asArray(sourceReport.sourceDocuments),
    humanApproval: {
      aiOcrRole: "draft_only",
      requiredBeforePublish: true,
      reapprovalRequiredForChanges: true,
      approvedBy: asArray(sourceReport.confirmedBy),
      remainsHumanApproved: HUMAN_APPROVAL_SCOPE,
      pendingFields: asArray(sourceReport.safetyReview && sourceReport.safetyReview.confirmationRequired),
    },
  };
}

export function buildNoticeExecutionPackage(payload, options = {}) {
  const sourcePayload = safeObject(payload);
  const draft = safeObject(sourcePayload.draft || sourcePayload);
  const reviewItems = sourcePayload.reviewItems || sourcePayload.review || [];
  const safetyReview = sourcePayload.safetyReview || buildSafetyReview(draft, reviewItems, options);
  const hasTransitImpact = hasValue(sourcePayload.lastMileImpact || sourcePayload.transitImpact);
  const generatedOutputs = [
    "住民向けQRページ",
    "A4周知チラシ",
    "変更履歴",
    "発注者向けレポート",
  ];
  if (hasTransitImpact) generatedOutputs.push("GTFS近接停留所確認");
  const changeHistory = sourcePayload.changeHistory || [
    {
      changedAt: generatedAt(options),
      summary: hasTransitImpact
        ? "既存資料から周知下書き・地図候補・GTFS近接停留所確認を生成"
        : "既存資料から周知下書き・地図候補を生成",
      approvedBy: null,
    },
  ];
  const ownerReport = buildOwnerReport(
    {
      ...sourcePayload,
      draft,
      reviewItems,
      safetyReview,
      changeHistory,
      deliverables: sourcePayload.deliverables || generatedOutputs,
      status: sourcePayload.status || (sourcePayload.publicUrl ? "published" : safetyReview.status),
    },
    options,
  );
  const validationRecord = buildValidationRecord(draft, reviewItems, options);
  const pilotPackage = buildPilotPackage(ownerReport, options);

  return {
    workflow: {
      sourceMode: "existing_documents",
      duplicateEntryRequired: false,
      manualCorrectionScope: ["低信頼項目", "地図候補がずれた場合", "公開前承認"],
      generatedOutputs,
    },
    ownerReport,
    safetyReview,
    validationRecord,
    pilotPackage,
  };
}
