/**
 * Dashboard webview script — bundled inline into the panel HTML.
 *
 * Exported as a pure function that takes `nonce`, serialized `dashboardData`,
 * and `browserDueTokenPatternSource` so it can be tested independently of the
 * HTML shell.
 */
export function buildDashboardWebviewScript(
  nonce: string,
  dashboardData: string,
  browserDueTokenPatternSource: string,
): string {
  return `<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const dashboardData = ${dashboardData};
    const savedState = vscode.getState() || {};
    const pendingCandidateAdds = [];

    // Populate model selector with available models
    (function populateModelSelector() {
      const modelSelect = document.getElementById("ai-model-select");
      if (modelSelect && dashboardData.availableModels && dashboardData.availableModels.length > 0) {
        // Keep the first "Auto select" option
        const autoOption = modelSelect.querySelector('option[value=""]');
        modelSelect.innerHTML = "";
        if (autoOption) {
          modelSelect.appendChild(autoOption);
        } else {
          const defaultOption = document.createElement("option");
          defaultOption.value = "";
          defaultOption.textContent = "自動選択";
          modelSelect.appendChild(defaultOption);
        }

        dashboardData.availableModels.forEach(function(model) {
          const option = document.createElement("option");
          option.value = model.id;
          option.textContent = model.name;
          modelSelect.appendChild(option);
        });

        // Restore selected model if any
        if (savedState.selectedModel) {
          modelSelect.value = savedState.selectedModel;
        }
      }
    })();

    const browserDueTokenPattern = new RegExp(${browserDueTokenPatternSource}, "i");

    function sanitizeBrowserTaskText(text) {
      return String(text || "")
        .replaceAll(String.fromCharCode(13) + String.fromCharCode(10), String.fromCharCode(10))
        .split(String.fromCharCode(10))
        .map(function (line) {
          return line.trim();
        })
        .filter(Boolean)
        .join(" / ")
        .split(/\s+/)
        .filter(Boolean)
        .join(" ")
        .trim();
    }

    function normalizedCandidateIdentity(text) {
      return sanitizeBrowserTaskText(text)
        .split(" ")
        .filter(function (part) {
          return !browserDueTokenPattern.test(part);
        })
        .join(" ")
        .trim()
        .normalize("NFKC")
        .toLowerCase();
    }

    function normalizeStoredCandidateTask(task) {
      if (!task || typeof task !== "object") {
        return null;
      }

      const text = sanitizeBrowserTaskText(typeof task.text === "string" ? task.text : "");
      if (!text) {
        return null;
      }

      return {
        kind: "candidate",
        text: text,
        dueDate:
          typeof task.dueDate === "string" && task.dueDate.length === 10 && task.dueDate[4] === "-" && task.dueDate[7] === "-"
            ? task.dueDate
            : null,
        category: typeof task.category === "string" && task.category.trim().length > 0 ? task.category : "other",
        priority: typeof task.priority === "string" && task.priority.trim().length > 0 ? task.priority : "medium",
        timeEstimateMin:
          typeof task.timeEstimateMin === "number" && Number.isFinite(task.timeEstimateMin)
            ? task.timeEstimateMin
            : 0,
        source: task.source === "notes" ? "notes" : "moments",
        sourceLabel:
          typeof task.sourceLabel === "string" && task.sourceLabel.trim().length > 0
            ? task.sourceLabel
            : task.source === "notes"
              ? "Notes"
              : "Moments",
        existsAlready: Boolean(task.existsAlready),
      };
    }

    function normalizeStoredCandidateTaskForSource(task, fallbackSource) {
      if (!task || typeof task !== "object") {
        return null;
      }

      const normalizedTask = normalizeStoredCandidateTask(task);
      if (!normalizedTask) {
        return null;
      }

      const legacySourceLabel =
        typeof task.sourceLabel === "string" && task.sourceLabel.trim().length > 0
          ? task.sourceLabel
          : typeof task.sourceNote === "string" && task.sourceNote.trim().length > 0
            ? task.sourceNote
            : fallbackSource === "notes"
              ? "Notes"
              : "Moments";

      return {
        ...normalizedTask,
        source: fallbackSource,
        sourceLabel: legacySourceLabel,
      };
    }

    function migrateLegacyCandidateState(savedState) {
      if (Array.isArray(savedState.candidateTasks)) {
        const candidateTasks = savedState.candidateTasks
          .map(function (task) {
            const normalizedTask = normalizeStoredCandidateTask(task);
            if (!normalizedTask) {
              return null;
            }

            return {
              ...normalizedTask,
              order: typeof task.order === "number" ? task.order : undefined,
              added: Boolean(task.added),
              extractRunAt: typeof task.extractRunAt === "string" ? task.extractRunAt : undefined,
              extractionIndex:
                typeof task.extractionIndex === "number"
                  ? task.extractionIndex
                  : typeof task.order === "number"
                    ? task.order
                    : 0,
            };
          })
          .filter(Boolean);
        const maxOrder = candidateTasks.reduce(function (highest, task) {
          return typeof task.order === "number" && task.order > highest ? task.order : highest;
        }, -1);
        return {
          candidateTasks: candidateTasks,
          candidateOrderSeed:
            typeof savedState.candidateOrderSeed === "number"
              ? savedState.candidateOrderSeed
              : maxOrder + 1,
          addedCandidateKeys: Array.isArray(savedState.addedCandidateKeys)
            ? savedState.addedCandidateKeys.filter(function (key) {
                return typeof key === "string" && key.length > 0;
              })
            : [],
        };
      }

      let nextOrder = 0;
      const fromMoments = (Array.isArray(savedState.extractedTasks) ? savedState.extractedTasks : []).map(
        function (task) {
          const normalizedTask = normalizeStoredCandidateTaskForSource(task, "moments");
          if (!normalizedTask) {
            return null;
          }

          return {
            ...normalizedTask,
            order: nextOrder++,
            added: Array.isArray(savedState.addedExtractedKeys)
              ? savedState.addedExtractedKeys.includes(normalizedCandidateIdentity(normalizedTask.text))
              : false,
            extractionIndex: nextOrder - 1,
          };
        },
      ).filter(Boolean);
      const fromNotes = (Array.isArray(savedState.notesExtractedTasks) ? savedState.notesExtractedTasks : []).map(
        function (task) {
          const normalizedTask = normalizeStoredCandidateTaskForSource(task, "notes");
          if (!normalizedTask) {
            return null;
          }

          return {
            ...normalizedTask,
            order: nextOrder++,
            added: Array.isArray(savedState.notesAddedExtractedKeys)
              ? savedState.notesAddedExtractedKeys.includes(normalizedCandidateIdentity(normalizedTask.text))
              : false,
            extractionIndex: nextOrder - 1,
          };
        },
      ).filter(Boolean);

      return {
        candidateTasks: fromMoments.concat(fromNotes),
        candidateOrderSeed: nextOrder,
        addedCandidateKeys: (Array.isArray(savedState.addedExtractedKeys) ? savedState.addedExtractedKeys : []).concat(
          Array.isArray(savedState.notesAddedExtractedKeys) ? savedState.notesAddedExtractedKeys : [],
        ),
      };
    }

    const migratedCandidates = migrateLegacyCandidateState(savedState);

    const state = {
      filter: savedState.filter === "focus" ? "attention" : (savedState.filter || "all"),
      search: savedState.search || "",
      editingId: savedState.editingId || null,
      candidateTasks: migratedCandidates.candidateTasks,
      candidateOrderSeed: migratedCandidates.candidateOrderSeed,
      addedCandidateKeys: Array.isArray(savedState.addedCandidateKeys)
        ? savedState.addedCandidateKeys
        : migratedCandidates.addedCandidateKeys,
      aiStatus: savedState.aiStatus || "",
      aiStatusType: savedState.aiStatusType || "idle",
      notesFromDate: savedState.notesFromDate || getDefaultDate(7),
      notesToDate: savedState.notesToDate || dashboardData.today,
      notesAiStatus: savedState.notesAiStatus || "",
      notesAiStatusType: savedState.notesAiStatusType || "idle",
      candidateBlockShown: savedState.candidateBlockShown || false,
      candidateBlockError: savedState.candidateBlockError || "",
      selectedModel: savedState.selectedModel || "",
      advancedPanelOpen: savedState.advancedPanelOpen || false,
    };

    function getDefaultDate(daysAgo) {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().split("T")[0];
    }

    const simplifiedSectionOrder = ["today", "planned", "unsorted", "done"];
    const simplifiedSectionTitles = {
      today: "Today",
      planned: "Planned",
      unsorted: "Unsorted",
      done: "Done",
    };
    const simplifiedSectionDescriptions = {
      today: "今日と期限超過",
      planned: "7日以内と先の予定",
      unsorted: "inbox や日付なしの棚卸し待ち",
      done: "完了済み",
    };

    const filterDefinitions = [
      { id: "all", label: "All", count: dashboardData.tasks.length },
      { id: "today", label: "Today", count: dashboardData.sectionCounts.overdue + dashboardData.sectionCounts.today },
      { id: "planned", label: "Planned", count: dashboardData.sectionCounts.upcoming + dashboardData.sectionCounts.scheduled },
      { id: "done", label: "Done", count: dashboardData.sectionCounts.done },
    ];

    const taskSearchInput = document.getElementById("task-search");
    const filterRow = document.getElementById("filter-row");
    const taskList = document.getElementById("dashboard-main-list");
    const newTaskText = document.getElementById("new-task-text");
    const aiStatus = document.getElementById("ai-status");
    const notesFromDateInput = document.getElementById("notes-from-date");
    const notesToDateInput = document.getElementById("notes-to-date");
    const notesStatus = document.getElementById("notes-extract-status");

    if (!taskSearchInput || !filterRow || !taskList || !newTaskText || !aiStatus || !notesFromDateInput || !notesToDateInput || !notesStatus) {
      throw new Error("Task Dashboard failed to initialize required webview controls.");
    }

    function persistState() {
      vscode.setState({
        filter: state.filter,
        search: state.search,

        editingId: state.editingId,
        candidateTasks: state.candidateTasks,
        candidateOrderSeed: state.candidateOrderSeed,
        addedCandidateKeys: state.addedCandidateKeys,
        aiStatus: state.aiStatus,
        aiStatusType: state.aiStatusType,
        notesFromDate: state.notesFromDate,
        notesToDate: state.notesToDate,
        notesAiStatus: state.notesAiStatus,
        notesAiStatusType: state.notesAiStatusType,
        candidateBlockShown: state.candidateBlockShown,
        candidateBlockError: state.candidateBlockError,
        selectedModel: state.selectedModel,
        advancedPanelOpen: state.advancedPanelOpen,
      });
    }

    function esc(value) {
      return String(value)
        .replace(new RegExp("&", "g"), "&amp;")
        .replace(new RegExp("<", "g"), "&lt;")
        .replace(new RegExp(">", "g"), "&gt;")
        .replace(new RegExp('"', "g"), "&quot;");
    }

    function formatDateLabel(date) {
      if (!date) {
        return "No date";
      }

      const parts = date.split("-");
      if (parts.length !== 3) {
        return date;
      }

      return Number.parseInt(parts[1], 10) + "/" + Number.parseInt(parts[2], 10);
    }

    function extractedTaskKey(task) {
      return normalizeTaskIdentity(task.text);
    }

    function canAddDashboardCandidate(task, existingTaskKeys) {
      if (existingTaskKeys && existingTaskKeys.has(extractedTaskKey(task))) {
        return false;
      }

      return !task.existsAlready;
    }

    function normalizeTaskIdentity(text) {
      return normalizedCandidateIdentity(text);
    }

    function createPendingCandidateRequestId(task) {
      return "candidate-" + String(task.order) + "-" + Date.now();
    }

    function removePendingCandidateAdd(requestId) {
      const index = pendingCandidateAdds.findIndex(function (pending) {
        return pending.requestId === requestId;
      });
      if (index < 0) {
        return null;
      }

      const pending = pendingCandidateAdds[index];
      pendingCandidateAdds.splice(index, 1);
      return pending;
    }

    function getExistingTaskKeys() {
      const persistedTaskKeys = (dashboardData.tasks || [])
        .map(function (task) {
          return normalizeTaskIdentity(task.text);
        })
        .filter(Boolean);
      state.addedCandidateKeys = (state.addedCandidateKeys || []).filter(function (key) {
        return !persistedTaskKeys.includes(key);
      });
      const locallyAddedKeys = (state.addedCandidateKeys || []).filter(Boolean);
      return new Set(
        persistedTaskKeys
          .concat(locallyAddedKeys)
          .filter(Boolean),
      );
    }

    function matchesDashboardListItemFilter(item, filter) {
      if (filter === "all") {
        return true;
      }

      if (item.kind === "candidate") {
        return false;
      }

      if (filter === "today") {
        return item.section === "overdue" || item.section === "today";
      }

      if (filter === "planned") {
        return item.section === "upcoming" || item.section === "scheduled";
      }

      if (filter === "done") {
        return item.section === "done";
      }

      return item.section === filter;
    }

    function matchesDashboardListItemSearch(item, query) {
      const normalizedQuery = String(query || "").trim().toLowerCase();
      if (!normalizedQuery) {
        return true;
      }

      const haystack = item.kind === "candidate"
        ? [
            item.text,
            item.sourceLabel || "",
            item.source || "",
            item.category || "",
            item.priority || "",
            item.dueDate || "",
            item.existsAlready ? "already exists" : "",
            "candidate",
          ]
        : [item.text, item.relativePath || "", item.date || "", item.dueDate || ""].concat(item.tags || []);

      return haystack.join(" ").toLowerCase().includes(normalizedQuery);
    }

    function buildDashboardListViewModel(items, filter, search) {
      function buildDashboardEmptyMessage(filter) {
        switch (filter) {
          case "all":
            return "No tasks yet||Use Add Task or AI Extract to create your first task.";
          case "today":
            return "Nothing scheduled for today";
          case "planned":
            return "No planned tasks";
          case "done":
            return "No completed tasks";
          default:
            return "No items in this filter";
        }
      }

      const normalizedSearch = String(search || "").trim();
      const filteredItems = items.filter(function (item) {
        return matchesDashboardListItemFilter(item, filter);
      });
      const visibleItems = filteredItems.filter(function (item) {
        return matchesDashboardListItemSearch(item, search);
      });
      if (filter === "all") {
        if (normalizedSearch && visibleItems.length === 0) {
          return { sections: [], emptyMessage: "No matching tasks" };
        }

        if (!normalizedSearch && filteredItems.length === 0) {
          return { sections: [], emptyMessage: buildDashboardEmptyMessage("all") };
        }

        const sections = [];

        simplifiedSectionOrder.forEach(function (simplifiedSection) {
          let internalSections;
          if (simplifiedSection === "today") {
            internalSections = ["overdue", "today"];
          } else if (simplifiedSection === "planned") {
            internalSections = ["upcoming", "scheduled"];
          } else if (simplifiedSection === "unsorted") {
            internalSections = ["backlog"];
          } else {
            internalSections = ["done"];
          }

          const taskItems = visibleItems.filter(function (item) {
            return item.kind === "task" && internalSections.includes(item.section);
          });
          if (!normalizedSearch || taskItems.length > 0) {
            sections.push({
              key: simplifiedSection,
              title: simplifiedSectionTitles[simplifiedSection],
              items: taskItems,
            });
          }
        });

        return { sections: sections, emptyMessage: null };
      }

      if (filteredItems.length === 0) {
        return {
          sections: [],
          emptyMessage: buildDashboardEmptyMessage(filter),
        };
      }

      if (visibleItems.length === 0) {
        return {
          sections: [],
          emptyMessage: normalizedSearch ? "No matching tasks" : buildDashboardEmptyMessage(filter),
        };
      }

      return {
        sections: [],
        flatItems: visibleItems,
        emptyMessage: null,
      };
    }

    function getVisibleCandidates() {
      const existingTaskKeys = getExistingTaskKeys();
      return (state.candidateTasks || [])
        .map(function (task) {
          return {
            ...task,
            existsAlready: existingTaskKeys.has(extractedTaskKey(task)) || Boolean(task.existsAlready),
          };
        })
        .filter(function (task) {
          return !task.added;
        })
        .sort(function (a, b) {
          const aRunAt = a.extractRunAt || "";
          const bRunAt = b.extractRunAt || "";
          if (aRunAt !== bRunAt) {
            return bRunAt.localeCompare(aRunAt);
          }
          return (a.order || 0) - (b.order || 0);
        });
    }

    function mergeCandidateBatch(source, tasks) {
      const retained = (state.candidateTasks || []).filter(function (task) {
        return task.source !== source;
      });
      const extractRunAt = new Date().toISOString();
      const merged = (tasks || []).map(function (task) {
        return {
          kind: "candidate",
          source: source,
          sourceLabel: task.sourceLabel || (source === "notes" ? "Notes" : "Moments"),
          existsAlready: Boolean(task.existsAlready),
          order: state.candidateOrderSeed++,
          added: false,
          ...task,
          extractRunAt: extractRunAt,
        };
      });
      state.candidateTasks = retained.concat(merged);
    }

    function getListViewModel() {
      const listItems = (dashboardData.tasks || []).filter(function (item) {
        return item.kind === "task";
      });
      return buildDashboardListViewModel(listItems, state.filter, state.search);
    }

    function renderFilters() {
      filterDefinitions[0].count = dashboardData.tasks.length + getVisibleCandidates().length;
      filterDefinitions[1].count = dashboardData.sectionCounts.overdue + dashboardData.sectionCounts.today;
      filterDefinitions[2].count = dashboardData.sectionCounts.upcoming + dashboardData.sectionCounts.scheduled;
      filterDefinitions[3].count = dashboardData.sectionCounts.done;
      filterRow.innerHTML = filterDefinitions
        .map(function (filter) {
          const activeClass = filter.id === state.filter ? " is-active" : "";
          return '<button type="button" class="filter-chip' + activeClass + '" data-filter="' + esc(filter.id) + '">' +
            '<span>' + esc(filter.label) + '</span>' +
            '<strong>' + filter.count + '</strong>' +
          "</button>";
        })
        .join("");
    }

    function renderTaskMeta(task) {
      const badges = [];
      if (task.date) {
        badges.push('<span class="badge task-row-meta-item task-row-meta-date">' + esc(formatDateLabel(task.date)) + "</span>");
      }
      if (task.dueDate) {
        const dueClass = task.section === "overdue" ? " is-danger" : task.section === "today" ? " is-warning" : " is-accent";
        badges.push('<span class="badge task-row-meta-item task-row-meta-due' + dueClass + '">Due ' + esc(formatDateLabel(task.dueDate)) + "</span>");
      }
      for (const tag of task.tags || []) {
        badges.push('<span class="badge is-accent task-row-meta-item task-row-meta-tag">' + esc(tag) + "</span>");
      }
      badges.push('<span class="badge task-row-meta-item task-row-meta-source task-row-meta-source-saved">' + esc(task.relativePath) + "</span>");
      return '<div class="task-row-meta task-row-meta-saved">' + badges.join("") + "</div>";
    }

    function renderCandidateMeta(task) {
      const badges = [];
      if (task.dueDate) {
        badges.push('<span class="badge is-accent task-row-meta-item task-row-meta-candidate-due">Due ' + esc(formatDateLabel(task.dueDate)) + "</span>");
      }
      if (task.category) {
        badges.push('<span class="badge task-row-meta-item task-row-meta-category">' + esc(task.category) + "</span>");
      }
      if (task.priority) {
        badges.push('<span class="badge task-row-meta-item task-row-meta-priority">' + esc(task.priority) + "</span>");
      }
      badges.push('<span class="badge task-row-meta-item task-row-meta-source task-row-meta-source-candidate">' + esc(task.sourceLabel || "Unknown") + "</span>");
      return '<div class="task-row-meta task-row-meta-candidate">' + badges.join("") + "</div>";
    }

    function renderTaskActionIcon(action) {
      const icons = {
        edit: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M11.7 1.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-8 8L4 13l.7-2.7 8-8Zm-7 10.3 1.6-.4 6.9-6.9-1.2-1.2-6.9 6.9-.4 1.6Z"/></svg>',
        open: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 2h5v5h-1.5V4.6l-5.7 5.7-1-1 5.7-5.8H9V2Z"/><path fill="currentColor" d="M3 4.5A1.5 1.5 0 0 1 4.5 3H8v1.5H4.5v7h7V8H13v3.5A1.5 1.5 0 0 1 11.5 13h-7A1.5 1.5 0 0 1 3 11.5v-7Z"/></svg>',
        delete: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.5 2h3l.5 1H13v1.5H3V3h2.5l.5-1ZM4.5 6h1.5v6H4.5V6Zm3 0H9v6H7.5V6Zm3 0H12v6h-1.5V6Z"/><path fill="currentColor" d="M4 4.5h8V13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5Z" fill-opacity="0.18"/></svg>',
      };
      return icons[action] || "";
    }

    function renderTaskItem(task) {
      const itemClasses = [
        "task-row",
        "task-row-saved",
        task.done ? "is-done" : "",
        task.section === "overdue" ? "is-overdue" : "",
        task.section === "today" ? "is-today" : "",
      ]
        .filter(Boolean)
        .join(" ");

      if (state.editingId === task.id) {
        return '<article class="' + itemClasses + '" data-task-id="' + esc(task.id) + '" tabindex="-1">' +
          '<label class="task-row-toggle-entry"><input class="task-row-toggle" type="checkbox" data-action="toggle" data-task-id="' + esc(task.id) + '"' + (task.done ? " checked" : "") + "></label>" +
          '<div class="task-row-body">' +
            '<div class="task-edit">' +
              '<label class="field">' +
                "<span>Task</span>" +
                '<textarea data-role="edit-text">' + esc(task.text) + "</textarea>" +
              "</label>" +
              '<div class="field-grid">' +
                '<label class="field-compact">' +
                  "<span>Due</span>" +
                  '<input type="date" data-role="edit-due" value="' + esc(task.dueDate || "") + '">' +
                "</label>" +
                '<div class="field-compact">' +
                  "<span>Source</span>" +
                  '<input type="text" value="' + esc(task.relativePath) + '" disabled>' +
                "</div>" +
              "</div>" +
              '<div class="inline-actions">' +
                '<button type="button" class="btn btn-primary" data-action="save-edit" data-task-id="' + esc(task.id) + '">Save</button>' +
                '<button type="button" class="btn" data-action="cancel-edit">Cancel</button>' +
                '<button type="button" class="btn" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">Open File</button>' +
              "</div>" +
            "</div>" +
          "</div>" +
        "</article>";
      }

      return '<article class="' + itemClasses + '" data-task-id="' + esc(task.id) + '" tabindex="-1">' +
        '<label class="task-row-toggle-entry"><input class="task-row-toggle" type="checkbox" data-action="toggle" data-task-id="' + esc(task.id) + '"' + (task.done ? " checked" : "") + "></label>" +
        '<div class="task-row-body">' +
          '<div class="task-row-main">' +
            '<div class="task-row-title-entry"><button type="button" class="task-row-title" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">' + esc(task.text) + "</button></div>" +
            '<div class="task-row-secondary-actions">' +
              '<button type="button" class="task-row-action-icon" data-action="edit" data-task-id="' + esc(task.id) + '" title="Edit" aria-label="Edit">' + renderTaskActionIcon("edit") + '</button>' +
              '<button type="button" class="task-row-action-icon" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '" title="Open" aria-label="Open">' + renderTaskActionIcon("open") + '</button>' +
              '<button type="button" class="task-row-action-icon" data-action="delete" data-task-id="' + esc(task.id) + '" title="Delete" aria-label="Delete">' + renderTaskActionIcon("delete") + '</button>' +
            "</div>" +
            '<div class="task-row-more-menu">' +
              '<button type="button" class="task-row-more-btn" data-action="more" data-task-id="' + esc(task.id) + '">More</button>' +
              '<div class="task-row-more-dropdown" data-more-dropdown="' + esc(task.id) + '">' +
                '<button type="button" data-action="edit" data-task-id="' + esc(task.id) + '">Edit</button>' +
                '<button type="button" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">Open</button>' +
                '<button type="button" class="is-danger" data-action="delete" data-task-id="' + esc(task.id) + '">Delete</button>' +
              "</div>" +
            "</div>" +
          "</div>" +
          renderTaskMeta(task) +
        "</div>" +
      "</article>";
    }

    function renderCandidateItem(task, index) {
      const canAdd = canAddDashboardCandidate(task, getExistingTaskKeys());
      const itemClasses = ["task-row", "task-row-candidate", task.existsAlready ? "is-candidate-blocked" : ""]
        .filter(Boolean)
        .join(" ");
      return '<article class="' + itemClasses + '">' +
        '<div class="task-row-leading"><span class="badge task-row-label">AI</span></div>' +
        '<div class="task-row-body">' +
          '<div class="task-row-main">' +
            '<div class="task-row-title-entry"><div class="task-row-title">' + esc(task.text) + '</div></div>' +
            '<div class="task-row-candidate-actions">' +
              '<span class="badge task-row-label">Candidate</span>' +
              '<button type="button" class="text-btn" data-action="dismiss-candidate" data-index="' + index + '">Dismiss</button>' +
              '<button type="button" class="text-btn' + (canAdd ? '' : ' is-danger') + '"' + (canAdd ? '' : ' disabled') + ' data-action="add-candidate" data-index="' + index + '">Add</button>' +
              (canAdd ? '' : '<span class="badge is-danger">Already exists</span>') +
            '</div>' +
          '</div>' +
          renderCandidateMeta(task) +
        '</div>' +
      '</article>';
    }

    function renderCandidateBlock() {
      const candidateBlock = document.getElementById("candidate-block");
      const candidateItems = document.getElementById("candidate-items");
      if (!candidateBlock || !candidateItems) {
        return;
      }

      const visibleCandidates = getVisibleCandidates();
      const hasCandidates = visibleCandidates.length > 0;
      const shouldShow = state.candidateBlockShown || hasCandidates;

      if (!shouldShow) {
        candidateBlock.style.display = "none";
        return;
      }

      candidateBlock.style.display = "";
      if (!state.candidateBlockShown) {
        state.candidateBlockShown = true;
      }

      let html = "";
      if (state.candidateBlockError) {
        html += '<div class="candidate-block-error">' +
          '<span class="candidate-block-error-text">' + esc(state.candidateBlockError) + '</span>' +
          '<button type="button" class="candidate-block-error-dismiss" data-action="dismiss-candidate-error" aria-label="Dismiss error">&times;</button>' +
          '</div>';
      }

      if (!hasCandidates) {
        html += '<div class="empty-state">' +
          '<strong class="empty-state-title">No candidates yet</strong>' +
          '<p class="empty-state-body">Use AI Extract or From Notes to find task candidates from your Moments and notes.</p>' +
        '</div>';
        candidateItems.innerHTML = html;
        return;
      }

      html += visibleCandidates
        .map(function (task, index) {
          return renderCandidateItem(task, index);
        })
        .join("");

      candidateItems.innerHTML = html;
    }

    var candidateBlockEl = document.getElementById("candidate-block");
    if (candidateBlockEl) {
      candidateBlockEl.addEventListener("click", function (event) {
        var actionEl = event.target.closest("[data-action]");
        if (!actionEl) {
          return;
        }
        var action = actionEl.dataset.action;
        if (action === "dismiss-candidate-error") {
          state.candidateBlockError = "";
          persistState();
          rerender();
        } else if (action === "add-extracted" || action === "add-candidate") {
          handleAddExtractedAction(actionEl);
        } else if (action === "dismiss-extracted" || action === "dismiss-candidate") {
          handleDismissExtractedAction(actionEl);
        }
      });
    }

    function renderEmptyState(message) {
      const parts = String(message || "").split("||");
      const title = parts[0] || "";
      const body = parts[1] || "";
      return '<div class="empty-state">' +
        '<strong class="empty-state-title">' + esc(title) + '</strong>' +
        (body ? '<p class="empty-state-body">' + esc(body) + '</p>' : '') +
      '</div>';
    }

    function renderTasks() {
      const viewModel = getListViewModel();
      if (viewModel.emptyMessage) {
        taskList.innerHTML = renderEmptyState(viewModel.emptyMessage);
        return;
      }

      const visibleCandidates = getVisibleCandidates();
      if (viewModel.flatItems && viewModel.flatItems.length > 0) {
        taskList.innerHTML = viewModel.flatItems
          .map(function (item) {
            if (item.kind === "candidate") {
              const index = visibleCandidates.findIndex(function (candidate) {
                return candidate.order === item.order;
              });
              return renderCandidateItem(item, index);
            }
            return renderTaskItem(item);
          })
          .join("");
        return;
      }

      const html = viewModel.sections
        .map(function (section) {
          const subtitle = state.filter === "all"
            ? simplifiedSectionDescriptions[section.key]
            : "filtered items";
          const items = section.items
            .map(function (item) {
              if (item.kind === "candidate") {
                const index = visibleCandidates.findIndex(function (candidate) {
                  return candidate.order === item.order;
                });
                return renderCandidateItem(item, index);
              }
              return renderTaskItem(item);
            })
            .join("");
          return '<section class="task-section">' +
            '<div class="task-section-header">' +
              "<h3>" + esc(section.title) + "</h3>" +
              "<span>" + section.items.length + " · " + esc(subtitle) + "</span>" +
            "</div>" +
            '<div class="task-items">' + items + "</div>" +
          "</section>";
        })
        .join("");

      taskList.innerHTML = html;
    }

    function setAiStatus(type, message) {
      state.aiStatusType = type;
      state.aiStatus = message || "";
      persistState();

      aiStatus.className = "status-line" + (type === "error" ? " is-error" : "");
      aiStatus.textContent = state.aiStatus;
    }

    function setNotesAiStatus(type, message) {
      state.notesAiStatusType = type;
      state.notesAiStatus = message || "";
      persistState();

      notesStatus.className = "status-line" + (type === "error" ? " is-error" : "");
      notesStatus.textContent = state.notesAiStatus;
    }

    function syncStaticInputs() {
      taskSearchInput.value = state.search;
      notesFromDateInput.value = state.notesFromDate;
      notesToDateInput.value = state.notesToDate;
      setAiStatus(state.aiStatusType, state.aiStatus);
      setNotesAiStatus(state.notesAiStatusType, state.notesAiStatus);

      // Sync advanced panel
      const advancedPanel = document.getElementById("extract-advanced-panel");
      if (advancedPanel) {
        advancedPanel.style.display = state.advancedPanelOpen ? "block" : "none";
      }

      // Sync model selector
      const modelSelect = document.getElementById("ai-model-select");
      if (modelSelect) {
        modelSelect.value = state.selectedModel;
      }
    }

    function rerender() {
      persistState();
      renderFilters();
      renderTasks();
      renderCandidateBlock();
    }

    document.getElementById("btn-refresh").addEventListener("click", function () {
      vscode.postMessage({ command: "refresh" });
    });

    document.getElementById("btn-create-task").addEventListener("click", function () {
      const text = newTaskText.value.trim();
      if (!text) {
        setAiStatus("error", "Task text is required.");
        return;
      }

      newTaskText.value = "";
      state.aiStatus = "";
      state.aiStatusType = "idle";
      if (state.filter !== "all") {
        state.filter = "all";
      }
      persistState();
      vscode.postMessage({
        command: "createTask",
        text,
        targetDate: null,
        dueDate: null,
      });
    });

    newTaskText.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        document.getElementById("btn-create-task").click();
      }
    });

    // Advanced panel toggle
    const advancedToggleBtn = document.getElementById("btn-extract-advanced");
    const advancedPanel = document.getElementById("extract-advanced-panel");
    if (advancedToggleBtn && advancedPanel) {
      advancedToggleBtn.addEventListener("click", function () {
        state.advancedPanelOpen = !state.advancedPanelOpen;
        advancedPanel.style.display = state.advancedPanelOpen ? "block" : "none";
        persistState();
      });
    }

    // Model selection
    const modelSelect = document.getElementById("ai-model-select");
    if (modelSelect) {
      modelSelect.value = state.selectedModel;
      modelSelect.addEventListener("change", function (event) {
        state.selectedModel = event.target.value;
        persistState();
      });
    }

    document.getElementById("btn-ai-extract").addEventListener("click", function () {
      mergeCandidateBatch("moments", []);
      setAiStatus("processing", state.notesFromDate + " ～ " + state.notesToDate + " の Moments を分析しています...");
      rerender();
      vscode.postMessage({
        command: "aiExtract",
        fromDate: state.notesFromDate,
        toDate: state.notesToDate,
        modelId: state.selectedModel,
      });
    });

    document.getElementById("btn-extract-notes").addEventListener("click", function () {
      mergeCandidateBatch("notes", []);
      setNotesAiStatus("processing", state.notesFromDate + " ～ " + state.notesToDate + " のノートを分析しています...");
      rerender();
      vscode.postMessage({
        command: "extractFromNotes",
        fromDate: state.notesFromDate,
        toDate: state.notesToDate,
        modelId: state.selectedModel,
      });
    });

    document.getElementById("notes-from-date").addEventListener("input", function (event) {
      state.notesFromDate = event.target.value || dashboardData.today;
      persistState();
    });

    document.getElementById("notes-to-date").addEventListener("input", function (event) {
      state.notesToDate = event.target.value || dashboardData.today;
      persistState();
    });

    taskSearchInput.addEventListener("input", function (event) {
      state.search = event.target.value;
      rerender();
    });



    function handleAddExtractedAction(actionEl) {
      const index = Number.parseInt(actionEl.dataset.index || "-1", 10);
      const visibleCandidates = getVisibleCandidates();
      if (Number.isNaN(index) || !visibleCandidates[index]) {
        return;
      }

      const task = visibleCandidates[index];
      if (!canAddDashboardCandidate(task, getExistingTaskKeys())) {
        rerender();
        return;
      }

      const requestId = createPendingCandidateRequestId(task);
      pendingCandidateAdds.push({
        requestId: requestId,
        order: task.order,
        key: extractedTaskKey(task),
        source: task.source,
      });

      state.candidateTasks = (state.candidateTasks || []).map(function (candidate) {
        return candidate.order === task.order ? { ...candidate, added: true } : candidate;
      });
      if (!state.addedCandidateKeys.includes(extractedTaskKey(task))) {
        state.addedCandidateKeys = state.addedCandidateKeys.concat([extractedTaskKey(task)]);
      }
      persistState();

      vscode.postMessage({
        command: "addExtractedTask",
        requestId: requestId,
        text: task.text,
        dueDate: task.dueDate || null,
        targetDate: state.targetDate || null,
      });
      rerender();
    }

    function handleDismissExtractedAction(actionEl) {
      const index = Number.parseInt(actionEl.dataset.index || "-1", 10);
      const visibleCandidates = getVisibleCandidates();
      if (Number.isNaN(index) || !visibleCandidates[index]) {
        return;
      }

      const task = visibleCandidates[index];
      state.candidateTasks = (state.candidateTasks || []).filter(function (candidate) {
        return candidate.order !== task.order;
      });
      state.candidateBlockError = "";
      persistState();
      vscode.postMessage({
        command: "dismissExtractedTask",
        text: task.text,
      });
      rerender();
    }

    filterRow.addEventListener("click", function (event) {
      const button = event.target.closest("[data-filter]");
      if (!button) {
        return;
      }

      state.filter = button.dataset.filter;
      rerender();
    });

    taskList.addEventListener("click", function (event) {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) {
        return;
      }

      const action = actionEl.dataset.action;
      if (action === "edit") {
        state.editingId = actionEl.dataset.taskId || null;
        rerender();
        return;
      }

      if (action === "cancel-edit") {
        state.editingId = null;
        rerender();
        return;
      }

      if (action === "save-edit") {
        const taskEl = actionEl.closest("article[data-task-id]");
        if (!taskEl) {
          return;
        }

        const textInput = taskEl.querySelector("[data-role='edit-text']");
        const dueInput = taskEl.querySelector("[data-role='edit-due']");
        const nextText = textInput ? textInput.value : "";
        const nextDue = dueInput ? dueInput.value : "";
        state.editingId = null;
        persistState();
        vscode.postMessage({
          command: "updateTask",
          taskId: actionEl.dataset.taskId,
          text: nextText,
          dueDate: nextDue || null,
        });
        return;
      }

      if (action === "delete") {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) {
          return;
        }

        vscode.postMessage({ command: "deleteTask", taskId });
        return;
      }

      if (action === "open") {
        vscode.postMessage({
          command: "openFile",
          filePath: actionEl.dataset.file || "",
          lineIndex: Number.parseInt(actionEl.dataset.line || "0", 10),
        });
        return;
      }

      if (action === "more") {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) {
          return;
        }
        const dropdown = document.querySelector('[data-more-dropdown="' + taskId + '"]');
        if (!dropdown) {
          return;
        }
        const isOpen = dropdown.classList.contains("is-open");
        document.querySelectorAll(".task-row-more-dropdown.is-open").forEach(function (d) {
          d.classList.remove("is-open");
        });
        if (!isOpen) {
          dropdown.classList.add("is-open");
        }
        return;
      }

      if (action === "add-extracted" || action === "add-candidate") {
        handleAddExtractedAction(actionEl);
        return;
      }

      if (action === "dismiss-extracted" || action === "dismiss-candidate") {
        handleDismissExtractedAction(actionEl);
        return;
      }
    });

    taskList.addEventListener("change", function (event) {
      const checkbox = event.target.closest("[data-action='toggle']");
      if (!checkbox) {
        return;
      }

      vscode.postMessage({
        command: "toggleTask",
        taskId: checkbox.dataset.taskId,
        done: checkbox.checked,
      });
    });

    document.addEventListener("click", function (event) {
      const moreBtn = event.target.closest("[data-action='more']");
      if (!moreBtn) {
        const openDropdown = document.querySelector(".task-row-more-dropdown.is-open");
        if (openDropdown) {
          openDropdown.classList.remove("is-open");
        }
      }
    });

    window.addEventListener("message", function (event) {
      const message = event.data;
      if (message.type === "aiStatus") {
        setAiStatus(message.status, message.message || "");
        rerender();
        return;
      }

      if (message.type === "extractResult") {
        state.filter = "all";
        state.candidateBlockShown = true;
        state.candidateBlockError = "";
        mergeCandidateBatch("moments", message.tasks || []);
        persistState();
        rerender();
        return;
      }

      if (message.type === "candidateAddResult") {
        state.candidateBlockError = "";
        removePendingCandidateAdd(message.requestId || null);
        rerender();
        return;
      }

      if (message.type === "candidateAddFailed") {
        const pending = removePendingCandidateAdd(message.requestId || null);
        if (pending) {
          state.candidateTasks = (state.candidateTasks || []).map(function (candidate) {
            return candidate.order === pending.order ? { ...candidate, added: false } : candidate;
          });
          state.addedCandidateKeys = (state.addedCandidateKeys || []).filter(function (key) {
            return key !== pending.key;
          });
        }
        state.candidateBlockError = message.message || "Failed to add candidate task.";
        if (pending && pending.source === "notes") {
          setNotesAiStatus("error", message.message || "Failed to add candidate task.");
        } else {
          setAiStatus("error", message.message || "Failed to add candidate task.");
        }
        rerender();
        return;
      }

      if (message.type === "notesAiStatus") {
        setNotesAiStatus(message.status, message.message || "");
        rerender();
        return;
      }

      if (message.type === "notesExtractResult") {
        state.filter = "all";
        state.candidateBlockShown = true;
        state.candidateBlockError = "";
        mergeCandidateBatch("notes", message.tasks || []);
        persistState();
        rerender();
      }
    });

    syncStaticInputs();
    rerender();
  </script>`;
}
