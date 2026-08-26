// Editing a drawing that is already hanging.
//
// Not pure — it builds DOM and saves. It exists as its own file because admin.js was
// already carrying the whole add flow, and an edit form is the same six fields again
// with a different verb.
//
// Only the label is editable here, not the picture. The crop, angle and adjustments are
// stored on the record and the untouched original is kept beside them, so re-framing a
// drawing years later is possible — but it means loading the original back into the
// editor, and that is a bigger thing than fixing a typo in a title.

import { monthsAt, ageLabel } from '../placard.js';

/** The label, field by field. One list so the form is a loop and nothing drifts. */
const FIELDS = [
  { name: 'title', label: 'Title', type: 'text', placeholder: 'Untitled' },
  { name: 'createdOn', label: 'Date drawn', type: 'date' },
  { name: 'medium', label: 'Medium', type: 'text' },
  { name: 'dimensions', label: 'Dimensions', type: 'text' },
  { name: 'alt', label: 'Alt text — what it shows', type: 'text' },
  { name: 'note', label: 'Note', type: 'textarea' },
];

/**
 * @param {object} artwork in the JSON contract
 * @param {{birthDate: string|null, onSave: Function, onCancel: Function,
 *          onDescribe: Function}} handlers
 * @returns {HTMLFormElement}
 */
export function buildEditForm(artwork, { birthDate, onSave, onCancel, onDescribe }) {
  const form = document.createElement('form');
  form.className = 'edit-form';

  const inputs = {};
  for (const spec of FIELDS) {
    const label = document.createElement('label');
    label.className = spec.name === 'note' || spec.name === 'alt' ? 'field field--wide' : 'field';
    const span = document.createElement('span');
    span.textContent = spec.label;

    const input = document.createElement(spec.type === 'textarea' ? 'textarea' : 'input');
    if (spec.type !== 'textarea') input.type = spec.type;
    else input.rows = 4;
    if (spec.placeholder) input.placeholder = spec.placeholder;
    // createdOn arrives as yyyy-mm-dd already; a date input accepts nothing else.
    input.value = artwork[spec.name] ?? '';
    inputs[spec.name] = input;

    label.append(span, input);
    form.append(label);
  }

  // What the label will say about the age, recomputed as the date is edited — the same
  // reassurance the add form gives, for the same reason: the age is stored, not derived,
  // so a wrong one is otherwise silent.
  const agePreview = document.createElement('small');
  agePreview.className = 'age-preview field--wide';
  const refreshAge = () => {
    const label = ageLabel(monthsAt(birthDate, inputs.createdOn.value));
    agePreview.textContent = birthDate
      ? (label ? `The label will read "Finn, age ${label}".` : 'No age will be shown for that date.')
      : 'No birth date available, so the label will carry no age.';
  };
  inputs.createdOn.addEventListener('input', refreshAge);
  refreshAge();
  form.append(agePreview);

  const actions = document.createElement('div');
  actions.className = 'edit-actions field--wide';

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn--primary';
  save.textContent = 'Save changes';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--quiet';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => onCancel());

  const describe = document.createElement('button');
  describe.type = 'button';
  describe.className = 'btn btn--quiet';
  describe.textContent = 'Write the label for me';

  const status = document.createElement('span');
  status.className = 'hint';

  describe.addEventListener('click', async () => {
    describe.disabled = true;
    status.textContent = 'Looking at the drawing…';
    try {
      const note = await onDescribe({
        title: inputs.title.value.trim(),
        medium: inputs.medium.value.trim(),
        dimensions: inputs.dimensions.value.trim(),
        createdOn: inputs.createdOn.value,
        note: inputs.note.value.trim(),
      });
      inputs.note.value = note;
      status.textContent = 'Written for you — edit it freely.';
    } catch (problem) {
      status.textContent = problem.message;
    } finally {
      describe.disabled = false;
    }
  });

  actions.append(save, cancel, describe, status);
  form.append(actions);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    status.textContent = 'Saving…';
    try {
      const patch = {};
      for (const spec of FIELDS) patch[spec.name] = inputs[spec.name].value.trim();
      // A blank title is Untitled here too, for the same reason it is on the way in.
      patch.title = patch.title || 'Untitled';
      // The age is stored rather than derived, so changing the date has to change it.
      const months = monthsAt(birthDate, patch.createdOn);
      if (months != null && months > 0) patch.ageMonths = months;
      await onSave(patch);
    } catch (problem) {
      save.disabled = false;
      status.textContent = problem.message;
    }
  });

  return form;
}
