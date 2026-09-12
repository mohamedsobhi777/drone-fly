# Third-party notices

## MaleCNS measured data — CC BY 4.0

`drone_fly/data/graph.json` contains an 80-neuron extract of the MaleCNS v1.0 minimum-confidence-0.5 tables. Data creators: FlyEM / HHMI Janelia, University of Cambridge, MRC Laboratory of Molecular Biology, and Google Research.

- Dataset and publication: https://male-cns.janelia.org/
- Download sources: https://male-cns.janelia.org/download/
- License: https://creativecommons.org/licenses/by/4.0/
- This copy has SHA-256 `2424c9dd2e44534e600aeda1a9058039b1f22a4bd983284a27adc10b22130719`.

The selection was published by Mert Cobanov in [Fly Dino](https://github.com/cobanov/flyjump), revision `c08c86bc18efd8125964b1d2ca4fc1df59700f30`. Credit is retained in the README and application's Methods & credits view. The pinned upstream [extraction protocol](https://github.com/cobanov/flyjump/blob/c08c86bc18efd8125964b1d2ca4fc1df59700f30/docs/experiment.md) explains the selection and source hashes.

We retain the measured neuron IDs, cell-body positions, neurotransmitter annotations and all selected directed edges unchanged. Drone Fly changes the interpretation of the eight input channels, the numerical input drive, the task, and the learned readout. These are engineering choices, not new biological measurements. The bundled manifest records the upstream extraction; `docs/METHODS.md` defines this project's runtime model.

No Fly Dino application code, Chromium code, template UI code, or Flybody meshes are included. The independently licensed dataset is not relicensed by the MIT license for original Drone Fly code. No upstream affiliation or endorsement is implied.

## Dependencies

MuJoCo is Apache-2.0; NumPy is BSD-3-Clause; Pillow is HPND. React, Three.js and FastAPI are MIT licensed. Other runtime and development dependencies retain their package licenses. Archivo and IBM Plex Mono are SIL Open Font License 1.1 fonts delivered through Fontsource; original licenses ship with the npm packages. Exact resolved dependencies are recorded in `uv.lock` and `web/package-lock.json`.

