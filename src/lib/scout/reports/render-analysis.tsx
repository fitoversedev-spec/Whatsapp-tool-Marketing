import type {
  AnalysisOverviewSection,
  PlaceInsightSection,
  PlaceInsightEntry,
  CompetitorLearningRow,
  OpportunityRow,
  PromotionRow,
  ChecklistRow,
} from "./types";

export function AnalysisOverview({ section }: { section: AnalysisOverviewSection }) {
  return (
    <div className="analysis-overview">
      {/* AT A GLANCE */}
      <div className="at-a-glance">
        <div className="glance-row">
          <div className="glance-item">
            <span className="glance-label">Market Saturation</span>
            <span className={`saturation-badge saturation-${section.marketSaturation.level.toLowerCase()}`}>
              {section.marketSaturation.level}
            </span>
          </div>
          <div className="glance-item">
            <span className="glance-label">Opportunity Score</span>
            <span className="glance-score">{section.opportunityScore.score}/10</span>
          </div>
          <div className="glance-item">
            <span className="glance-label">Risk Factors</span>
            <span className="glance-score">{section.risks.length}</span>
          </div>
        </div>
      </div>

      {/* WHAT THIS MEANS */}
      <h3 className="analysis-subheading">What This Means</h3>
      <ul className="means-list">
        {section.executiveRecommendation
          .split(/(?<=\.)\s+/)
          .filter((s) => s.trim().length > 0)
          .slice(0, 5)
          .map((sentence, i) => (
            <li key={i}>{sentence}</li>
          ))}
      </ul>

      {/* RISKS */}
      {section.risks.length > 0 && (
        <>
          <h3 className="analysis-subheading">Identified Risks</h3>
          <ul className="risks-list">
            {section.risks.map((risk, i) => (
              <li key={i}>{risk}</li>
            ))}
          </ul>
        </>
      )}

      {/* LEARNINGS */}
      {section.competitorLearnings.length > 0 && (
        <>
          <h3 className="analysis-subheading">Learnings from Competitor Complaints</h3>
          <table className="learnings-table">
            <thead>
              <tr>
                <th>Complaint pattern</th>
                <th>Seen at</th>
                <th>Our rule</th>
              </tr>
            </thead>
            <tbody>
              {section.competitorLearnings.map((l: CompetitorLearningRow, i: number) => (
                <tr key={i}>
                  <td>{l.complaint}</td>
                  <td>{l.seenAt}</td>
                  <td className="our-rule">{l.ourRule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* OPPORTUNITIES — numbered */}
      {section.opportunities.length > 0 && (
        <>
          <h3 className="analysis-subheading">Opportunities</h3>
          <ol className="numbered-list">
            {section.opportunities.map((o: OpportunityRow, i: number) => (
              <li key={i}>
                <strong>{o.title}</strong>
                <span className="item-detail"> — {o.detail}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {/* PROMOTION PLAN — numbered */}
      {section.promotionPlan.length > 0 && (
        <>
          <h3 className="analysis-subheading">Promotion Plan</h3>
          <ol className="numbered-list">
            {section.promotionPlan.map((p: PromotionRow, i: number) => (
              <li key={i}>
                <strong>{p.channel}</strong> — {p.action}
                <span className="timeline-tag">{p.timeline}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {/* LAUNCH CHECKLIST */}
      {section.launchChecklist.length > 0 && (
        <>
          <h3 className="analysis-subheading">Launch Checklist</h3>
          <table className="checklist-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Priority</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {section.launchChecklist.map((c: ChecklistRow, i: number) => (
                <tr key={i}>
                  <td>{c.task}</td>
                  <td>
                    <span className={`priority-badge priority-${c.priority.toLowerCase()}`}>
                      {c.priority}
                    </span>
                  </td>
                  <td className="timeline-cell">{c.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ONE-LINE STRATEGY */}
      {section.oneLineStrategy && (
        <div className="strategy-pitch">
          <span className="pitch-label">One-Line Strategy</span>
          <p className="pitch-text">&ldquo;{section.oneLineStrategy}&rdquo;</p>
        </div>
      )}
    </div>
  );
}

export function PlaceInsights({ section }: { section: PlaceInsightSection }) {
  return (
    <div className="place-insights">
      {/* COMPETITORS SUMMARY TABLE */}
      <table className="competitors-summary">
        <thead>
          <tr>
            <th>Competitor</th>
            <th>Established</th>
            <th>Reviews</th>
            <th>Pricing</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {section.places.map((place, i) => (
            <tr key={i}>
              <td className="name-cell">{place.name}</td>
              <td>{place.establishedDate === "Not Available" || place.establishedDate === "Insufficient data" ? "—" : place.establishedDate}</td>
              <td>{place.googleReviewsTone}</td>
              <td>{place.pricingNote ?? "—"}</td>
              <td><ConfidenceBadge level={place.confidence} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* COMPETITOR PROFILES */}
      <h3 className="analysis-subheading">Competitor Profiles</h3>
      {section.places.map((place, i) => (
        <CompetitorProfile key={i} place={place} />
      ))}
    </div>
  );
}

function CompetitorProfile({ place }: { place: PlaceInsightEntry }) {
  const hasWorks = place.whatWorks.length > 0;
  const hasDoesnt = place.whatDoesnt.length > 0;

  return (
    <div className="competitor-profile">
      <h4 className="profile-name">{place.name}</h4>

      {(hasWorks || hasDoesnt) && (
        <div className="profile-columns">
          {hasWorks && (
            <div className="profile-col profile-positive">
              <span className="profile-col-heading">What Works</span>
              <ul>
                {place.whatWorks.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {hasDoesnt && (
            <div className="profile-col profile-negative">
              <span className="profile-col-heading">What Doesn&apos;t</span>
              <ul>
                {place.whatDoesnt.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {place.suitability && place.suitability !== "Not Available" && (
        <p className="profile-verdict">
          <strong>Verdict:</strong> {place.suitability}
        </p>
      )}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: string }) {
  const cls =
    level === "High" ? "confidence-high" : level === "Medium" ? "confidence-medium" : "confidence-low";
  return <span className={`confidence-badge ${cls}`}>{level}</span>;
}
